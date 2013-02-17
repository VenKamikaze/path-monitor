// Tested with Cinnamon 1.6 in ArchLinux
// You must enter a path in the spot where it asks you to before applet will function
//
// Be wary, this applet will open ANY file with the default handler in the directory it monitors
// Do NOT point this at a downloads directory or an untrusted source of any kind!
//
// Disclaimer: I am not responsible for any data damage, bugs, 
// emotional hurt suffered or natural disasters that may arise from use
// of this applet. Use it carefully :)
//
// Version 0.9
// Author: Mick Saunders
//
// Changes for 0.9 : * Context menu for enabling/disabling file filtering
//                   * Context menu for advanced filtering using a basic kind of shell globbing, or RegExp
//                   * Allow separate filtering per instance of path-monitor
//                   * Allow the gschema to store these extra variables
//                   
// NOTE: Using a comma (,) is NOT supported for the path filtering at this time
//
// Changes for 0.55 (UNRELEASED) : * More complete support for file/path pattern exclusions.
// NOTE: You can change the fileExcludeFilter variable below to put in a list
//       of shell style patterns to match files on. Using comma (,) is NOT supported
//       as we use it to delineate the patterns you want to use to exclude files.
//       If you know REGEXP then enable the 'fullRegex' flag and you can use them too.
//
//
// Changes for 0.5 : * Hacky support for multiple instances.
//                   * Begin support for file/path pattern exclusions.
// NOTE: Multiple instances can be used by modifying the watchedpath key in dconf-editor.
//       Just comma separate each path, e.g.: /tmp,/home
//       Key is found under: com.servebeer.gamed.path-monitor@kamikaze
//
// Changes for 0.4 : * Fix for GSettings Schema being outside of user's $HOME (affected Arch)
//                   * Some code clean-ups
//
// Changes for 0.3 : * Tries to load a gsettings schema for the applet for a given path
//                   ** If this succeeds, the entered path will persist cinnamon restarts.
//                   * Only show 25 entries so the list doesn't scroll off the screen.
//                   * Made UUID consistent between metadata.json and applet.js, renamed applet path.
//
// Notes: This is my very first applet and in fact, my first GPL released code of any sort.
//        Go easy on me!

const NAME = 'path-monitor-test';
const UUID = NAME + '@kamikaze';

const Lang = imports.lang;
const Applet = imports.ui.applet;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;

const Gettext = imports.gettext.domain('cinnamon-applets');
const _ = Gettext.gettext;

const HOME = GLib.getenv("HOME");

const GSETTINGS_SCHEMA = 'com.servebeer.gamed.' + UUID;
const FALLBACK_GSETTINGS_PATH = HOME + "/.local/share/cinnamon/applets/" + NAME + "\@kamikaze";

const PATH_KEY = "watchedpaths";
const EXCLUDE_FLAGS_KEY = "excludeFlags";

// TODO: see if we can find out the font size and screen size and make this dynamic.
const MAX_LIST_SIZE = 25;

// Allow maximum of 5 instances of path-monitor.
const MAX_INSTANCES = 5;
const debug = true;

//-------------------------------------------------------------------
function debugLog(text) {
    if (debug) { global.log("Path-Monitor: " +text); }
}

function errorLog(text) {
    global.logError("Path-Monitor (E): " +text); 
}

//-------------------------------------------------------------------

function MyApplet(orientation, panel_height, workingPath, index, master) {
    this._init(orientation, panel_height, workingPath, index, master);
}

MyApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    _entry: null, // entry text box for path monitoring
    _excludeEntry: null,  // entry text box for file exclusion
    
    _init: function(orientation, panel_height, workingPath, index, master) {
        Applet.IconApplet.prototype._init.call(this, orientation, panel_height);

        this._orientation = orientation;
        this._panel_height = panel_height;
        this.metaPath = workingPath;
        
        try 
        {
        	this._pathMonID = index;
			
        	if (master)
			{
				debugLog("Set to master instance. pathMonID="+this._pathMonID);
				this._isMasterCopy = true;
				this._nextPathMonID = index;
				this._pathMonID = index;
				this._childApplets = new Array();
				setTimeout(Lang.bind(this, this._cloneApplet), 500);
			}

            this.set_applet_icon_name("folder-saved-search-symbolic");
            this.set_applet_tooltip(_("Click to list your files"));

            this.provider = new FileProvider();
            
            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);

            try
            {
                this._settings = loadSettings(GSETTINGS_SCHEMA, workingPath);
                this.path = this.getSettingString(PATH_KEY).split(",")[this._pathMonID];
            }
            catch (e)
            {
                errorLog(e);
            }
            // set up the settings right-click menu
            this._setupContextMenu();
        }
        catch (e) {
            errorLog(e);
        }
    },

    _setupContextMenu: function() 
    {
    	if (this.provider != null)
    	{
			let hiddenFilesSwitch = new PopupMenu.PopupSwitchMenuItem(_("Show hidden files"), this.provider.showHiddenFiles);
			let directoriesSwitch = new PopupMenu.PopupSwitchMenuItem(_("Show directories"), this.provider.showDirectories);
			let symlinksSwitch = new PopupMenu.PopupSwitchMenuItem(_("Show symbolic links"), this.provider.showSymlinks);
			let docTempSwitch = new PopupMenu.PopupSwitchMenuItem(_("Show temp document files"), this.provider.showDocTempFiles);
			
			this._applet_context_menu.addMenuItem(hiddenFilesSwitch);
			this._applet_context_menu.addMenuItem(directoriesSwitch);
			this._applet_context_menu.addMenuItem(symlinksSwitch);
			this._applet_context_menu.addMenuItem(docTempSwitch);
			
			hiddenFilesSwitch.connect('toggled', Lang.bind(this, function () { this.provider.toggleHiddenFiles(); this._onNotesChange(); } ));
			directoriesSwitch.connect('toggled', Lang.bind(this, function () { this.provider.toggleDirectories(); this._onNotesChange(); } ));
			symlinksSwitch.connect('toggled', Lang.bind(this, function () { this.provider.toggleSymlinks(); this._onNotesChange(); } ));
			docTempSwitch.connect('toggled', Lang.bind(this, function () { this.provider.toggleDocTempFiles(); this._onNotesChange(); } ));

            this._applet_context_menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

			this._excludeEntry = new St.Entry({name: 'excludeFilter',
										can_focus: true,
										track_hover: false,
										hint_text: _("Enter exclude file pattern")});
			this._excludeEntry.lastPattern = "";
			
			this._excludeEntry.connect('key-release-event', Lang.bind(this, function(entry, event) 
			{
				let key = event.get_key_symbol();
				if (key == Clutter.KEY_Return) 
				{
					this.provider.setExcludeFilter(this._excludeEntry.text);
					this._onNotesChange();
					
					return true;
				}
				else if (key == Clutter.KEY_Escape) 
				{
					this._excludeEntry.text = this._excludeEntry.lastPattern;
					return true;
				}
				return false;
			}));
			this._excludeEntry.set_style("padding-left: 1.7em;padding-top:5px;padding-bottom:5px;");
			this._applet_context_menu.addActor(this._excludeEntry);

            this._applet_context_menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._applet_context_menu.addAction("Monitor an extra path...", Lang.bind(this, function() {
                                                                            
                                                                    }
		}
    },

     _saveAllFlags: function() {
         let flags = 0;
         if(this.fileProvider.showHiddenFiles)
             
     },
    
     _onNotesChange: function () {
         this.menu.removeAll();
     	 this._updateMenu(this.provider.list(this.notes_directory));
         this._excludeEntry.lastPattern = this._excludeEntry.text;
     },
     
     _updateMenu: function (fileList) {
     	 for(let i = 0; i < fileList.length; i++)
     	 {
             let filePath = this.path + '/' + fileList[i];
     	 	 this.menu.addAction(fileList[i], Lang.bind(this, function() {
     	 	                                      this.provider.open(filePath); }));
     	 }
     },
     
     _setAndMonitorPath: function (path) {
     	 debugLog("Setting and monitoring new path=" + path);
     	 this.setPath(path);
         this.monitorPath(path);
         this.setSetting(PATH_KEY, path);
     },

     monitorPath: function (path) {
         this.notes_directory = Gio.file_new_for_path(path);

         this.monitor = this.notes_directory.monitor_directory(0, null, null);
         this.monitor.connect('changed', Lang.bind(this, this._onNotesChange));
         this._onNotesChange();

         this._entry.text = path;
     },
     
    showPath: function () {
        this._entry = new St.Entry({name: 'notePath',
                             can_focus: true,
                             track_hover: false,
                             hint_text: _("Enter a path to watch...")});
        this._entry.connect('key-release-event', Lang.bind(this, function(entry, event) 
        {
            let key = event.get_key_symbol();
            debugLog("key pressed ="+key);
            if (key == Clutter.KEY_Return) 
            {
                let path = this._entry.text;
                
                if ( Gio.file_new_for_path(path).query_exists(null) )
                {
                    this._setAndMonitorPath(path);
                }
                else
                {
                    errorLog("Path not found, or inaccessible: " + path);
                }
                return true;
            }
            else if (key == Clutter.KEY_Escape) 
            {
            	// doesn't seem to come in here?
            	debugLog("ESC pressed. path="+this.path+",this._entry.text="+this._entry.text);
            	this._entry.text = this.path;
                return true;
            }
            return false;
        }));
        this.menu.addActor(this._entry);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    },

    on_applet_clicked: function(event) {
    	this.menu.toggle();
    },
    
    on_applet_added_to_panel: function() {
    	// On first add, the master applet will enter into this function.
    	// Possible race condition here due to above.
    	// Also, if paths are changed on the applets via another method like dconf-editor
    	// then it will not realise this until cinnamon is restarted (applet is re-instantiated).
    	// TODO fix this
    	debugLog("In on_applet_added_to_panel!");
    	if(this.isMasterCopy())
    	{
    		for(let i = 0; i < this._childApplets.length; i++)
    		{
    			let child = this._childApplets[i];
    			debugLog("Adding child applet to panel, pathMonID="+child._pathMonID);
    			this._panelLocation.add(child.actor);
    			child._panelLocation = this._panelLocation;
    		}
    	}
    },
    
    on_applet_removed_from_panel: function() {
    	debugLog("In on_applet_removed_from_panel. Master? " + this.isMasterCopy());

    	if(this.isMasterCopy())
    	{
    		for(let i = 0; i < this._childApplets.length; i++)
    		{
    			let child = this._childApplets[i];
    			debugLog("Removing child applet from panel, pathMonID="+child._pathMonID);
    			child._panelLocation.remove_actor(child.actor);
    			child._panelLocation = null;
    		}
    	}
    },
    
    addChildApplet: function(child){
    	if(this.isMasterCopy())
    	{
    		this._childApplets.push(child);	
    	}
    },

    setPath: function (path) {
         this.lastPath = (this.path == null ? path : this.path);
         this.path = path;
    },

    // set a setting for our instance
    setSetting: function (key, value) 
    {
        try
        {
            // Handle multi-path
        	let allVals = this.getSettingString(key);
        	let newValue = new String();
        	let allValArray = allVals.split(",");
        	for(let p in allValArray)
        	{
        		newValue += (newValue.length > 0 ? "," : "");
        		if(p == this._pathMonID)
        		{
        			newValue += value;
        		}
        		else
        		{
        			newValue += allValArray[p];
        	    }
        	}
        	debugLog("Storing new setting. allVals="+allVals + " newVals="+newValue);
        	value = newValue;
        	this._settings.set_string(key, value);
        }
        catch (e)
        {
            errorLog(e);
        }
    },

    // for all instances
    getSettingString: function(key) 
    {
        try
        {
            return this._settings.get_string(key);
        }
        catch (e)
        {
            errorLog(e);
        }
        return null;
    },

    // only for our instance
    getFlags: function() 
    {
        let allFlags = "";
        try
        {
            let flagArray = [];
            allFlags = this._settings.get_string(EXCLUDE_FLAGS_KEY);
            flagArray = allFlags.split(",");
            return flagArray[this._pathMonID] == undefined ? null : flagArray[this._pathMonID];
        }
        catch (e)
        {
            errorLog(e);
        }
        return null;
    },

    _cloneApplet: function()
    {
    	debugLog("Spawning new path-monitor applets");
    	if (this._pathMonID <= 0)
    		return;
    	
       	let ourPanel = this._panelLocation;
       	for(let i = 0; i < (this._pathMonID); i++)
       	{
       		debugLog("Spawning new applet...");
       		setTimeout(Lang.bind(this, function() { 
       			          let childApplet = new MyApplet(this._orientation, this._panel_height, this.metaPath, this.getNextPathMonID(), false);
       			          this.addChildApplet(childApplet);
       			          ourPanel.add(childApplet.actor, {x_align: ourPanel.x_align});
       			          childApplet._panelLocation = ourPanel;
       			          childApplet.showPath();
       			          childApplet.monitorPath(childApplet.path);
       		            }), (30*i)+20);
       	}
    },
    
    isMasterCopy: function()
    {
    	return (this._isMasterCopy != undefined && this._isMasterCopy);
    },
    
    getNextPathMonID: function()
    {
    	if (this.isMasterCopy())
    	{
    		return (--this._nextPathMonID);
    	}
    	return 0;
    }

};

//-------------------------------------------------------------------

function main(metadata, orientation, panel_height) {
    let gsettings = loadSettings(GSETTINGS_SCHEMA, metadata.path);
    let allPaths = new String(gsettings.get_string(PATH_KEY));
   
	let myApplet = new MyApplet(orientation, panel_height, metadata.path, (allPaths.split(",").length -1), true);
	myApplet.showPath();
	myApplet.monitorPath(myApplet.path);
	
    return myApplet;
}

//convenience
function setTimeout(func, time)
{
	Mainloop.timeout_add(time, func);
}

function isMasterCopyRunning()
{
	let currentApplets = global.settings.get_strv("enabled-applets");
	for(let i in currentApplets)
	{
		if(currentApplets[i].indexOf(UUID))
			return true;
	}
	return false;
}


//-------------------------------------------------------------------
// Get the path of where the notes live from the settings file

function findSchemaPath(workingPath) {
    let schemaPathfile = Gio.file_new_for_path(workingPath + "/gschemas.compiled");
    if(! schemaPathfile.query_exists(null))
    {
        debugLog("Could not find gschema in working path="+workingPath);
        debugLog("Checking fallback path for schema");
        schemaPathFile = Gio.file_new_for_path(FALLBACK_GSETTINGS_PATH + "/gschemas.compiled");
        if(! schemaPathfile.query_exists(null))
        {
            errorLog("Could not find a valid gschema. Please place gschemas.compiled in applet path");
            return null;
        }
        return FALLBACK_GSETTINGS_PATH;
    }
    return workingPath;
}

function loadSettings(schemaId, path) {
    schemaSettings = loadGSchemaSettings(schemaId, findSchemaPath(path));
    return Gio.Settings.new_full(schemaSettings, null, null);
}

function loadGSchemaSettings(schemaId, path) {
    if (path == null) 
        return null;

    schemaSource = Gio.SettingsSchemaSource.new_from_directory(path, null, false, null);
    settingsSchema = schemaSource.lookup(schemaId, false);
    if(settingsSchema == null) { errorLog("Could not find gschema at path="+path); }
    return settingsSchema;
}

//-------------------------------------------------------------------
// Thanks to Josh Gertzen's article to set up nicer OO inheritance in javascript
// Credit: http://joshgertzen.com/object-oriented-super-class-method-calling-with-javascript/

//Defines the top level Class
function Class() { }
Class.prototype.construct = function() {};
Class.extend = function(def) {
  var classDef = function() {
      if (arguments[0] !== Class) { this.construct.apply(this, arguments); }
  };
 
  var proto = new this(Class);
  var superClass = this.prototype;
 
  for (var n in def) {
      var item = def[n];                      
      if (item instanceof Function) item.$ = superClass;
      proto[n] = item;
  }
 
  classDef.prototype = proto;
 
  //Give this new class the same static extend method    
  classDef.extend = this.extend;      
  return classDef;
};

//-------------------------------------------------------------------
// abstract noteProvider.
var NoteProvider = Class.extend({
    patterns: new String(),
    patternList: [],


    // Put in the list of file patterns, comma separated, you wish to exclude from the file list.
    // e.g. to exclude files starting with 'a' and files ending in 'b' 
    //         you'd do: var fileExcludeFilter = "a*,*b";
	fileExcludeFilter: "", 
	
	// to make it simpler for people we use shell style globbing
    // instead of full Regex support. Basically we just replace
    // '*' with '.*'
	fullRegex: false,    

    // For people that don't know regular expressions, we make it a simple switch to set up
    // the regexp required to show or hide gedit/vim style backup files (files that end in ~)
    showDocTempFiles: false,

    docTempFlag: 0x8,
    _tempDocFilePattern: ".*\~",

    toggleDocTempFiles: function () { this.showDocTempFiles = (! this.showDocTempFiles); this._setupFilter(this.fileExcludeFilter, this.fullRegex); },
    getEnabledFlags: function () { return this.showDocTempFiles ? this.docTempFlag : 0; },
    
    construct: function() 
	{
		// defaults.
		this._setupFilter(this.fileExcludeFilter, this.fullRegex);
	},

	_setupFilter: function(pattern, isRegex)
	{
		// fix up the pattern filter to be regex compliant for searching
	    if( ! isRegex)
	    {
	      this.patterns = pattern.replace(new RegExp("\\.", "g"), "\\.");
	      this.patterns = this.patterns.replace(new RegExp("\\*", "g"), ".*");
	    }
	    else
	      this.patterns = pattern;

        if ( ! this.showDocTempFiles) // don't show them/setup the regexp to exclude them
          this.patterns += (this.patterns.length > 0) ? ("," + this._tempDocFilePattern) : this._tempDocFilePattern;
	    
		debugLog("setupFilter: patterns=" + this.patterns);

	    if (this.patterns.length > 0)
	      this.patternList = this.patterns.split(","); // TODO: instead of looping over an array, make this a single regexp
        else
          this.patternList = [];
	},
	
	setExcludeFilter: function (newFilter, isRegex)
	{
		this._setupFilter(newFilter, isRegex);
	},
	
	type: function() { return "NoteProvider"; },
	list: function(noteLocation) { throw 'Not implemented!'; },
 	update: function() { throw 'Not implemented!'; },
 	passesExcludeFilter: function (noteName) 
 	{ 
		let matches = false; // if it matches, we exclude it.
		debugLog("patterns=" + this.patterns);
		if(this.patternList.length > 0)
		{
			for(let i = 0; i < this.patternList.length; i++)
			{
				let pattern = this.patternList[i];
				matches |= new RegExp(pattern, 'gi').test(noteName); // match on it...
			}
		}
		return (!matches);  // poor var/func name - if it matches it DOESN'T pass the exclude filter
 	},
 	
 	open: function (note) { throw 'Not implemented!'; }
});


//-------------------------------------------------------------------
// impl -- allows retrieval of files/notes from local paths
var FileProvider = NoteProvider.extend({

	// Show hidden files, symlinks, directories,
    showHiddenFiles: false,
    showDirectories: true,
    showSymlinks: true,
    
    hiddenFileFlag: 0x1,
    directoryFlag: 0x2,
    symlinkFlag: 0x4,

    toggleHidden: function () { this.showHiddenFiles = (! this.showHiddenFiles); },
    toggleDirectories: function () { this.showDirectories = (! this.showDirectories); },
    toggleSymlinks: function () { this.showSymlinks = (! this.showSymlinks); },

    getEnabledFlags: function () { 
        let flags = 0;
        flags |= this.showHiddenFiles ? this.hiddenFileFlag : 0;
        flags |= this.showDirectories ? this.directoryFlag : 0;
        flags |= this.symlinkFlag ? this.symlinkFlag : 0;
        flags |= arguments.callee.$.getEnabledFlags.call(this);
        return flags;
    },
		
	type: function() 
	{ 
		return "FileProvider";	
	},
	
	list: function(directory) 
	{ 
		fileList = new Array();
		if (directory.query_exists(null)) 
		{
			infos = directory.enumerate_children('standard::name,standard::is-symlink,standard::is-hidden,standard::type,standard::size', 0, null, null)
			let child_info = null;
			while (fileList.length < MAX_LIST_SIZE && (child_info = infos.next_file(null, null)) != null)
			{
				if(this.passesExcludeFilter(child_info))
				{
					fileList.push(child_info.get_name());
				}
			}
		}
		
		return fileList;
	},
	
 	update: function() 
 	{ 
 		throw 'Not implemented!'; 
 	},
 	
 	passesExcludeFilter: function (queryInfo)
 	{
		let result = false;
		
		switch(queryInfo.get_file_type())
		{
			case Gio.FileType.SYMBOLIC_LINK:      // doesn't seem to work?
				result = this.showSymlinks; 
				break;
			case Gio.FileType.DIRECTORY:
				result = this.showDirectories;
				break;
			default:
				result = true;
				break;
		}
		
		if (! this.showSymlinks)
		{
			result &= (!queryInfo.get_attribute_boolean(Gio.FILE_ATTRIBUTE_STANDARD_IS_SYMLINK));	// this works
		}
		
		if (! this.showHiddenFiles)
		{
			result &= (!queryInfo.get_attribute_boolean(Gio.FILE_ATTRIBUTE_STANDARD_IS_HIDDEN));
		}
		
		// Call super class to do the filename pattern matching
		result &= arguments.callee.$.passesExcludeFilter.call(this, queryInfo.get_name());
		
		return result;
 	},
	
 	open: function (name) 
 	{ 
		let f = Gio.file_new_for_path(name);
		let uri = f.get_uri();
		Gio.app_info_launch_default_for_uri(uri, null);
 	}	
});
