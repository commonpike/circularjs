/* ----------------------
		modules 
----------------------- */
	
function CircularModule(name,def) {

	if (!def) def = {};
	if (name) {

		if (!def.config)					def.config = {};
	
		if (!def.settings)				def.settings 			= { name : name };		
		if (!def.attributes)			def.attributes 		= { };
		
		// store this
		def.settings.name = name;
		
		if (def.settings.name=='modules') {
			def.add(def);
		} else {
			Circular.modules.add(def);
		}
		
	} else if (Circular.log) {
		Circular.log.fatal('CircularModule: Name is required');
	} else {
		alert('CircularModule: Name is required');
		Circular.die();
	}
}

// modules is the first module
new CircularModule('modules', {
		
	config				: {
		attrprefix		: 'cc-',
		debug					: false,
	},
	
	settings 			: {
	
	},

	attributes		: {
	
	},
	
	comments			: {
	
	},
	
	init	: function(config) {

		this.debug('Circular.modules.init');
		
		if (!config.modules) config.modules = {};
		
		// all the modules are loaded and
		// attributes assigned. clean it up.
		
		// optionally rewrite cc- attributes
		
		if (!config.modules.attrprefix) config.modules.attrprefix='cc-';
		if (config.modules.attrprefix!='cc-') {
			
			this.attrprefix 	= config.modules.attrprefix;
			this.rxattrprefix = new RegExp('^'+config.modules.attrprefix);
			
			// change shortcuts in the mod.attributes
			for (var mc=0 ;mc<this.modnames.length;mc++) {
				var mod = Circular[this.modnames[mc]];
				for (var ac=0; ac<mod.attributes.length; ac++) {
					var attrname = mod.attributes[ac].name;
					var newattrname = this.prefix(attrname);
					// make attr lookup faster
					mod.attributes[newattrname] = mod.attributes[ac];
					delete mod.attributes[attrname];
				}
			}
			
			// change shortcuts in this.attrnames
			var newattrnames = [];
			for (var ac=0; ac<this.attrnames.length; ac++) {
				var attrname = this.attrnames[ac];
				var newattrname = this.prefix(attrname);
				newattrnames.push(newattrname);
				this.attr2mod[newattrname] = this.attr2mod[attrname];
				delete this.attr2mod[attrname];
			}
			this.attrnames=newattrnames;
			
		}
		
		// make reverse attr lookup faster
		for (var ac=0; ac<this.attrnames.length; ac++) {
			this.attr2idx[this.attrnames[ac]]=ac;
		}
		
		// loop all modules, process includes and config
		var css = '';
		this.modnames.forEach(function(modname) {
		
			if (Circular[modname].settings.insertcss) {
				Circular[modname].settings.insertcss.forEach(function(str) {
					css += str;
				})
			}
			
			// extend config from init call and attach it globally, too
			if (Circular[modname].config) {
				if (config[modname]) $.extend(true,Circular[modname].config,config[modname]);
				Circular.config[modname] = Circular[modname].config;
			}
			
		});
		
		if (css) {
			var styleElement = document.createElement("style");
			styleElement.type = "text/css";
			document.head.appendChild(styleElement);
			
			// ruff stuff. probs in ie<9
			styleElement.appendChild(document.createTextNode(css));
		}
		
		for(var mc=0; mc<this.modnames.length; mc++) {
			var modname = this.modnames[mc];
			if (Circular[modname]!=this && Circular[modname].init) {
				Circular[modname].init();
			}
		};
			
		
	},
	
	
	// ------------------
	
	modnames		: [],
	attrnames		: [],	
	attr2idx		: {
		// map attribute names to their index (faster)
	},
	attr2mod		: {
		// map attribute names to modules
	},
	comm2mod		: {
		// map comment names to modules
	},
	
	// read once from config during init
	attrprefix		: 'cc-',
	rxattrprefix	: /^cc-/,
	
	
	prefix	: function(attrname) {
		if (this.attrprefix!='cc-') {
			return attrname.replace(/^cc-/,this.attrprefix);
		}
		return attrname;
	},
	
	unprefix	: function(attrname) {
		if (this.attrprefix!='cc-') {
			return attrname.replace(this.rxattrprefix,'cc-');
		}
		return attrname;
	},
	
	add	: function(mod) {
	
		
		this.debug('Circular.modules.add',mod.settings.name);
		
		if (!Circular.dead) {

			valid = true;

			if (this.modnames.indexOf(mod.settings.name)!=-1) {
				if (Circular.log) Circular.log.error('Circular.modules.add','mod.'+mod.settings.name+' is already added');
				valid=false;
			}
			
			if (mod.settings.requiremods) {
				mod.settings.requiremods.forEach(function(name) {
					if (Circular.modules.modnames.indexOf(name)==-1) {
						if (Circular.log) Circular.log.error('Circular.modules.add','mod.'+mod.settings.name+' requires mod.'+name);
						valid=false;
					}
				},this);
			}
			
			if (valid) {
			
				// store the module
				this.modnames.push(mod.settings.name);
				Circular[mod.settings.name]	= mod;
				
				// store the attributes
				var sorted = [];
				for (var attrname in mod.attributes) {
					var attr = mod.attributes[attrname];
					if (attr.priority===undefined) {
						attr.priority=sorted.length;
					}
					if (sorted[attr.priority]) {
						Circular.log.warn('@modules.add',mod.settings.name,attrname,'changing dupe priority',attr.priority);
						attr.priority=sorted.length;
					}
					attr.name = attrname;
					this.attr2mod[attrname]=mod.settings.name;
					sorted[attr.priority]=attrname;
				}
				for (var ac=sorted.length-1; ac>=0 ;ac--) {
					if (sorted[ac]) this.attrnames.push(sorted[ac]);
				}

				// store the comment handlers
				for (var c in mod.comments) {
					this.comm2mod[c]=mod.settings.name
				}
				
			} else {
				// crucial. i think i want you.
				if (Circular.log) Circular.log.fatal('Circular.modules.add','fatal error');
				Circular.die();
			}
		}

	},
	
	debug	: function() {
		if (this.config.debug && Circular.log) {
			Circular.log.debug.apply(Circular.log,arguments);
		}
	}	
	
	
	
});