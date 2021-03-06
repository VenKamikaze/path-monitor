// Tested with Cinnamon 1.6 in ArchLinux
// You must enter a path in the spot where it asks you to before applet will function
//
// Be wary, this applet will open ANY file with the default handler in the directory it monitors
// Do NOT point this at a downloads directory or an untrusted source of any kind!
//
// Disclaimer: I am not responsible for any data damange, bugs, 
// emotional hurt suffered or natural disasters that may arise from use
// of this applet. Use it carefully :)
//
// Version 0.5
// Author: Mick Saunders
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

const NAME = 'path-monitor';
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
const PATH_KEY = "watchedpath";

// TODO: see if we can find out the font size and screen size and make this dynamic.
const MAX_LIST_SIZE = 25;

// Allow maximum of 5 instances of path-monitor.
const MAX_INSTANCES = 5;
const debug = false;

// Put in the list of file patterns, comma separated, you wish to exclude from the file list.
// e.g. to exclude files starting with 'a' you'd do: const FILE_EXCLUDE_FILTER = "a*";
var FILE_EXCLUDE_FILTER = ""; // TODO, this isn't implemented yet.

// Show hidden files, symlinks, directories,
const SHOW_HIDDEN_FILES = false;
const SHOW_DIRECTORIES = true;
const SHOW_SYMLINKS = true;

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

            this.provider = new fileProvider();
            
            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);

            try
            {
                this._settings = loadSettings(GSETTINGS_SCHEMA, workingPath);
                this.path = this.getSetting(PATH_KEY).split(",")[this._pathMonID];
            }
            catch (e)
            {
                errorLog(e);
            }

        }
        catch (e) {
            errorLog(e);
        }
    },

     _onNotesChange: function () {
         this.menu.removeAll();
     	 this._updateMenu(this.provider.list(this.notes_directory));
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
            if (key == Clutter.KEY_Return) 
            {
                let path = this._entry.text;
                
                if ( Gio.file_new_for_path(path).query_exists(null) )
                {
                    this._setAndMonitorPath(path);
                }
                else
                {
                    debugLog("Path not found, or inaccessible: " + path);
                }
                return true;
            }
            else if (key == Clutter.KEY_Escape) 
            {
                return true;
            }
            return false;
        }));
        this.menu.addActor(this._entry);
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

    setSetting: function (key, value) 
    {
        try
        {
        	if (key == PATH_KEY)
        	{
        		// Handle multi-path
        		let allPaths = this.getSetting(PATH_KEY);
        		let newValue = new String();
        		let pathsArray = allPaths.split(",");
        		for(let p in pathsArray)
        		{
        			newValue += (newValue.length > 0 ? "," : "");
        			if(p == this._pathMonID)
        			{
        				newValue += value;
        			}
        			else
        			{
        				newValue += pathsArray[p];
        			}
        		}
        		debugLog("Storing new path. allPaths="+allPaths + " newPaths="+newValue);
        		value = newValue;
        	}
        	this._settings.set_string(key, value);
        }
        catch (e)
        {
            errorLog(e);
        }
    },

    getSetting: function(key) 
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

// abstract class
function noteProvider() { }

noteProvider.prototype.type = function () {
	throw 'Not implemented!';
};

noteProvider.prototype.list = function (fileLocation) {
	throw 'Not implemented!';
};

noteProvider.prototype.update = function () {
	throw 'Not implemented!';
};

noteProvider.prototype.passesExcludeFilter = function (type) {
	let passes = true;
	if(FILE_EXCLUDE_FILTER.length > 0)
	{
		for(let i = 0; i < FILE_EXCLUDE_FILTER.split(","); i++)
		{
			// match on it...
		}
	}
	return passes;
}

noteProvider.prototype.open = function (name) {
	throw 'Not implemented!';
	//GLib.spawn_command_line_async('xdg-open ' + name);
};

//-------------------------------------------------------------------

// impl -- allows retrieval of files/notes from local paths

function fileProvider() {
	this._init();
}

fileProvider.prototype = new noteProvider();
fileProvider.prototype.constructor = fileProvider;
fileProvider.baseConstructor = noteProvider;
fileProvider.superClass = noteProvider.prototype;

fileProvider.prototype.passesExcludeFilter = function (queryInfo) 
{
    let result = false;

	switch(queryInfo.get_file_type())
	{
		case Gio.FileType.SYMBOLIC_LINK:
			result = SHOW_SYMLINKS;      // doesn't seem to work?
			break;
		case Gio.FileType.DIRECTORY:
			result = SHOW_DIRECTORIES;
			break;
		default:
			result = true;
			break;
	}
	
	if (! SHOW_SYMLINKS)
	{
		result &= (!queryInfo.get_attribute_boolean(Gio.FILE_ATTRIBUTE_STANDARD_IS_SYMLINK));	// this works
	}
	
	if (! SHOW_HIDDEN_FILES)
	{
		result &= (!queryInfo.get_attribute_boolean(Gio.FILE_ATTRIBUTE_STANDARD_IS_HIDDEN));
	}
	
	return result;
};

fileProvider.prototype.list = function (directory) {
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
};

fileProvider.prototype.open = function (name) {
    let f = Gio.file_new_for_path(name);
    let uri = f.get_uri();
	Gio.app_info_launch_default_for_uri(uri, null);
};

fileProvider.prototype.type = function () {
	return 'FileProvider';	
};

fileProvider.prototype._init = function () {

}
