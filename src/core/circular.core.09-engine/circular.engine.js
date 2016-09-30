	
/* ----------------------
	engine
----------------------- */

new CircularModule({

	name				: 'engine',	
	requires		: ['root','context','content','log','debug','registry'],
	config			: { 
		rootselector 	: '',
		greedy				: false, // trim whitespace from inline expressions
	},
	counter			: 0,
	genid				: 0,
	greedy			: true,
	
	init				: function() {
		this.greedy = this.config.greedy;
	},
	
	start				: function() {
		Circular.debug.write('@engine.start ');
		var rootsel = Circular.config.rootselector;
		if (!rootsel) {
			rootsel = '[cc-root],';
			rootsel += '['+Circular.config.dataprefix+'cc-root]';
		}
		var $root = $(rootsel);
		if (!$root.size()) $root = $('html');
		this.recycle($root,true);
	},
	
	recycle	: function(nodes,now) {
		Circular.debug.write('@engine.recycle ');
		if (nodes instanceof jQuery) {
			nodes = nodes.toArray();
		} else if (!Array.isArray(nodes)) {
			nodes = [nodes];
		}
		
		if (!nodes) return this.start();
		
		if (!now) {
			Circular.queue.add(function() {
				Circular.engine.recycle(nodes,true);
			});
			return true;
		}
		//alert('recycle');
		
		this.sort(nodes);
		
		nodes.forEach(function(node) {
			// lock nodes
			Circular.registry.lock(node);
		});
		
		nodes.forEach(function(node) {
			var ccnode = Circular.registry.get(node,true);
			if (ccnode.flags.locked) {
				Circular.debug.write('@engine.recycle ','Recycling',node);
				this.process(node);
			} else {
				Circular.debug.write('@engine.recycle ','Node was already recycled',node,ccnode);
			}
		},this);

		
		return true;
	},
	
	sort 				: function(nodes) {
		var sorted = [];
		if (nodes.length) {
			for (var nc=0; nc<nodes.length;nc++) {
				// create sorted array
				var inside = false;
				for (var sc=0; sc<sorted.length;sc++) {
					//console.log(nc,sc);
					if (sorted[sc].contains(nodes[nc])) {
						inside = true;
					} else {
						if (inside) {
							// bottom. insert before
							//console.log('bottom',nc,sc);
							sorted.splice(sc,0,nodes[nc]);
							break;
						} else if (nodes[nc].contains(sorted[sc])) {
							// middle. insert before
							//console.log('middle/top',nc,sc);
							sorted.splice(sc,0,nodes[nc]);
							break;
						}
					}
				}
				if (sc==sorted.length) {
					//console.log('append',nc,sc);
					sorted.push(nodes[nc]);
				}
			}
		}
		nodes=sorted;
		return sorted;
		
	},
	
	getContext	: function(node) {
		Circular.debug.write('@engine.getContext',node.nodeName);
		// you rarely need this. while cycling the document,
		// the context is passed to the process() method or
		// taken from @context.current. only when out of a 
		// cycle, if you address a node that has not been
		// indexed, you may need to find the context it would
		// have had if it were indexed within a cycle.

		var ccnode = Circular.registry.get(node,true);
		if (ccnode.props.outercontext) return ccnode.props.outercontext;
		else {
			var $parents = $(node).parents();
			for (var pc=0; pc < $parents.size(); pc++) {
				var ccnode = Circular.registry.get($parents.eq(pc),true);
				if (ccnode.props.innercontext) {
					return ccnode.props.innercontext;
				}
			}
		}
		return Circular.config.rootcontext;
	
	},
	
	process			: function (node,context) {
		if (node instanceof jQuery) node = node.get(0);
		Circular.debug.write('@engine.process',node.nodeName,context);
		if (!node) {
			Circular.log.fatal('@engine.process','no node given');
		}
		if (Circular.dead) {
			Circular.log.fatal('@engine.process','Circular died X-|');
			return false;
		}
		// cruft
		// if (node instanceof jQuery) node = $node.get(0);
		this.counter++;
		
		var ccnode = Circular.registry.get(node,true);
		ccnode.flags.locked=true; // for new nodes
		
		if (context) {
			if (context != ccnode.props.outercontext) {
				Circular.debug.write('@engine.process','context changed',ccnode.props.outercontext,context,node);
				ccnode.props.outercontext = context;
				ccnode.flags.contextchanged=true;
			} else {
				Circular.debug.write('@engine.process','context not changed');
			}
		} else {
			if (!ccnode.props.outercontext) {
				Circular.debug.write('@engine.process','no context, searching',node);
				//ccnode.props.outercontext = Circular.context.get();
				ccnode.props.outercontext = this.getContext(node);
				Circular.debug.write('@engine.process','found context',ccnode.props.outercontext);
			} else {
				Circular.debug.write('@engine.process','no context: using stored',ccnode.props.outercontext,node);
			}
		}
		Circular.context.set(ccnode.props.outercontext);
		
		switch(node.nodeType) {
		
			case Node.ELEMENT_NODE:
			
				if (this.processElementNode(node,ccnode)) {
					Circular.debug.write('@engine.process','registered',node);
				} else {
					Circular.debug.write('@engine.process','ignored',node);
				}

				break;
				
			case Node.TEXT_NODE:
			
				if (this.processTextNode(node,ccnode)) {
					Circular.debug.write('@engine.process','processed',node);
				} else {
					Circular.debug.write('@engine.process','ignored',node);
				}
				
				break;
				
			case Node.COMMENT_NODE:
			
				Circular.debug.write('@engine.process ','ignoring comments '+node.nodeType);
				break;
				
			default:
			
				Circular.debug.write('@engine.process ','ignoring node type '+node.nodeType);
		}
		
		// if it was registered along the way,
		// now is the time to let go
		if (ccnode.flags.registered) {
			Circular.registry.unlock(node);
		}
		
	},

	processElementNode				: function(node,ccnode) {
		Circular.debug.write('@engine.processElementNode');

		var newcontext = false;

		if (ccnode.flags.contextchanged || ccnode.flags.attrsetchanged || ccnode.flags.attrdomchanged || ccnode.flags.attrdatachanged) {
		
			//if (ccnode.flags.attrdomchanged || ccnode.flags.attrsetchanged ) {
				this.indexAttributes(node,ccnode);
			//}
			
			if (ccnode.ccattrlist.length) {
			
				Circular.debug.write('@engine.processElementNode','processing attrs in ..',node);
				
				// evaluate and fill out attrs, execute modules
				// this will return false if one of the modules
				// return false to interrupt the cycle
				
				var recurse = this.processAttributesIn(node,ccnode);
				
				Circular.debug.write('@engine.processElementNode','processed attrs in',node);


				var innercontext = Circular.context.get();
				if (ccnode.props.innercontext!=innercontext) {
					newcontext = ccnode.props.innercontext = innercontext;
				}
				
				// register changes now, so the watchdog can
				// observe changes made by children
				Circular.registry.set(node,ccnode,true);
				
				if ( recurse &&  ( newcontext || ccnode.flags.contentchanged ) ) {
					this.processChildren(node,newcontext);
				} 
				
				Circular.debug.write('@engine.processElementNode','processing attrs out ..',node);
				this.processAttributesOut(node,ccnode);
				Circular.debug.write('@engine.processElementNode','processed attrs out',node);
				
				// register the final version
				Circular.registry.set(node,ccnode,true);
				
				return true;
				
			} else {
				
				// after looking at the attributes,
				// there was nothing particular, but
				
				var innercontext = Circular.context.get();
				if (ccnode.props.innercontext!=innercontext) {
					newcontext = ccnode.props.innercontext = innercontext;
				}
				
				if (newcontext || ccnode.flags.contentchanged) {
					
					
					
					// if this was already registered and it changed here,
					// remember that. otherwise, nothing much to remember
					
					if (ccnode.flags.registered) {
						Circular.registry.set(node,ccnode,true);
					} 
					
					Circular.debug.write('@engine.processElementNode','processing content',node);
					
					this.processChildren(node,newcontext);
					
					
					Circular.debug.write('@engine.processElementNode','processed content',node);
					
					// and the final version
					
					if (ccnode.flags.registered) {
						
						Circular.registry.set(node,ccnode,true);
						return true;
					} else {
						return false;
					}
					
					
				} else {
					// no important attr, 
					// no new content, 
					// inner context didnt change
					
					// stop
					return false;
				}
					
			}
			
		} else {
		

			// we can ignore the attributes. but
			
			var innercontext = Circular.context.get();
			if (ccnode.props.innercontext!=innercontext) {
				newcontext = ccnode.props.innercontext = innercontext;
			}
			
			if (newcontext || ccnode.flags.contentchanged) {
			
				// if this was already registered and it changed here,
				// remember that. otherwise, nothing much to remember
				
				if (ccnode.flags.registered) {
					Circular.registry.set(node,ccnode,true);
				} 
				
				Circular.debug.write('@engine.processElementNode','processing content',node);
				
				this.processChildren(node,newcontext);
				
				Circular.debug.write('@engine.processElementNode','processed content',node);
				
				// and the final version
				if (ccnode.flags.registered) {
					Circular.registry.set(node,ccnode,true);
					return true;
				} else {
					return false;
				}
				
			} else {
				// no attributes
				// no new content
				// inner context didnt change
				// stop
				return false;
			}
			
		}
		
	},
	
	indexAttributes	: function(node,ccnode) {
		Circular.debug.write('@engine.indexAttributes');
		
		// loop all the nodes attributes
		// see if they contain expression or 
		// if they are modules. other attributes
		// are ignored.

		// the order is important here. 
		// modules should go first, so there are
		// executed before normal attributes. also,
		// the mods need to be sorted in the
		// order they were created ..
		
		// if the node was registered in a previous
		// cycle, use the original values from there
		
		var regattrs = ccnode.ccattrlist;
		var ccattrs = [], plain = [], mods = [];
		
		for(var ac=0; ac<node.attributes.length;ac++) {
			var ccattr = null;
			var attrname = node.attributes[ac].name;
			
			//ccattr = ccnode.ccattrs[attrname];
			
			// see if it was registered
			for (var ri=0;ri<regattrs.length;ri++) {
				if (regattrs[ri].name==attrname) {
					ccattr=regattrs[ri];
					break;
				}
			}
			
			// else, create a new property from this attribute
			if (!ccattr) ccattr = Circular.registry.newCCattribute(attrname);
			
			var ccattrcname = Circular.modules.attr2cname[attrname];
			var modidx = Circular.modules.attr2idx[ccattrcname];
			if (modidx!==undefined) {
				var modname = Circular.modules.stack[modidx].name;
				if (this.indexModuleAttribute(node,ccattr,modname)) {
					mods[modidx]=ccattr;
					mods[modidx].watches = Circular.modules.stack[modidx].watches;
				}
			} else {
				if (this.indexAttribute(node,ccattr)) {
					plain.push(ccattr);
				}
			}
		}
		
		// stack these up in the right order:
		for (var idx in mods) {
			ccattrs.push(mods[idx]);
		}
		ccnode.ccattrlist = ccattrs.concat(plain);
		
		// now put the watches in place
		Circular.debug.write('@engine.indexAttributes','attributes pre',ccnode.ccattrlist);
		for (var pc=0; pc < ccnode.ccattrlist.length; pc++) {
			if (ccnode.ccattrlist[pc].watches) {
				for (var wc=0; wc<ccnode.ccattrlist[pc].watches.length;wc++) {
					Circular.debug.write('@engine.indexAttributes','moving watch',ccnode.ccattrlist[pc].watches[wc]);
					for (var pc2=0; pc2 < ccnode.ccattrlist.length; pc2++) {
						if (ccnode.ccattrlist[pc2].name==ccnode.ccattrlist[pc].watches[wc]) {
							Circular.debug.write('@engine.indexAttributes','found watch',ccnode.ccattrlist[pc].watches[wc]);
							// move ccnode.ccattrlist[pc2] before ccnode.ccattrlist[pc]
							ccnode.ccattrlist.splice(pc,0,ccnode.ccattrlist.splice(pc2,1)[0]);
							if (pc2>pc) pc++;
							break;
						}
					}
				}
			}
		}
		Circular.debug.write('@engine.indexAttributes','attributes post',ccnode.ccattrlist);
		
		// map them by name - youll need it
		for (var idx in ccnode.ccattrlist) {
			ccnode.ccattrs[ccnode.ccattrlist[idx].name] = ccnode.ccattrlist[idx];
		}
	},
	

	indexModuleAttribute			: function(node,ccattr,modname) {
		Circular.debug.write('@engine.indexModuleAttribute',modname);
		
		
		if (this.indexAttribute(node,ccattr)) {
			// returns true if it is an expression
			
			ccattr.props.module=modname;
			return true;
			
		} else {
		
			// even if its not an expression, a module
			// is always registered for just being one. 
			
			if (!ccattr.flags.registered) {
				ccattr.cname		= Circular.modules.attr2cname[ccattr.props.name];
				ccattr.props.module 	= modname;
			}
			var original 	= node.getAttribute(ccattr.props.name);
			ccattr.props.original = original;
			ccattr.props.value		= original;
			//ccattr.props.result		= original;
				
			return true;
			
		}
		
	},
	
	indexAttribute			: function(node,ccattr) {
		Circular.debug.write('@engine.indexAttribute',ccattr.props.name);
		
		// check if the attribute is an expression
		// update the properties of ccattr, but
		// dont evaluate it yet - this will happen in
		// processAttributesIn, in the right order
		
		// return true if it should be registered
		// false if it shouldnt
		
		if (ccattr.flags.attrdomchanged) {
			Circular.debug.write('@engine.indexAttribute','attrdomchanged',ccattr.props.original);
			
			var expression = '', original = '';
			
			if (ccattr.props.name.indexOf('-debug')==-1) { // hm
			
				// the dom changed, so ignore what was registered:
				ccattr.props.original = node.getAttribute(ccattr.props.name);
				expression	= ccattr.props.expression;
				
				// parse returns an expression without {{}},
				// or an empty string if there is no expression	
				
				if (Circular.parser.parseAttribute(ccattr,Circular.context.get())) {

					if (Circular.debug.enabled && ccattr.props.name!='cc-debug') {
						if (ccattr.props.name.indexOf('cc-')==0) node.setAttribute('cc-'+ccattr.props.name.substring(3)+'-debug',ccattr.props.original);
						else node.setAttribute('cc-'+ccattr.props.name+'-debug',ccattr.props.original);
					}
			
					return true;
					
				} else {
				
					// so its not an expression (anymore)
					// ignore it or forget it
					//alert('forget '+node.nodeName+'.'+ccattr.props.name);
					
					
					if (Circular.debug.enabled) {
						if (ccattr.props.name.indexOf('cc-')==0) node.removeAttribute('cc-'+ccattr.props.name.substring(3)+'-debug');
						else node.removeAttribute('cc-'+ccattr.props.name+'-debug');
					}
					return false;

				}
			} else {
				// dont register debug attributes
				return false;
			}
		} else {
		
			
			
			// nothing changed, so do nothing,
			// but if it was registered, remember it
			return ccattr.flags.registered;
			
		}
		
	},
	
	processAttributesIn	: function(node,ccnode) {
		Circular.debug.write('@engine.processAttributesIn',node);
		// loop all attributes forward
		// evaluate optional expressions
		// if its a module, execute mod.in. 
		// if it returns false, break
		
		//console.log('processAttributesIn',node,ccattrs);
		
		for (var dc=0; dc<ccnode.ccattrlist.length; dc++) {
		
			var ccattr = ccnode.ccattrlist[dc];
			
			if (ccattr.flags.attrdomchanged || ccattr.flags.attrdatachanged) {
				
				// (re-)eval this attribute, be it a full match
				// or  a string containing matches 
				
				if (ccattr.props.expression) {
					var result = Circular.parser.eval.call(node,ccattr.props.expression);

					
					if (result!=ccattr.props.result) {
					
						ccattr.props.result = result;
						Circular.debug.write('@engine.processAttributesIn','changed',ccattr.props.name,ccattr.props.expression,ccattr.props.result);
						try {
							if (result===undefined) ccattr.props.value = ''; 
							else if (typeof ccattr.props.result == 'object') ccattr.props.value = ccattr.props.original;
							else ccattr.props.value = ccattr.props.result.toString();
						} catch (x) {
							ccattr.props.value = '';
							Circular.log.warn(x);
						}
						if (Circular.watchdog  && ccnode.flags.watched ) { // watched was commented ?
							Circular.watchdog.pass(node,'attrdomchanged',ccattr.props.name);
						}
						node.setAttribute(ccattr.props.name,ccattr.props.value);
						//alert(ccattr.props.value);
						
					} 
				} else {
					ccattr.props.result = undefined;
					ccattr.props.value = ccattr.props.original;
				}
				
					
			}

			// even if it didnt change, you need to execute it
			// because it could change things for other attributes
			if (ccattr.props.module) {
				Circular.debug.write('@engine.processAttributesIn','executing',ccattr.props.module);
				var mod = Circular.modules.stack[Circular.modules.name2idx[ccattr.props.module]];
				var func = mod.in;
				if (func) {
					var ok = func.call(mod,ccattr,node,ccnode);
					if (ok===false) {
						ccattr.flags.breaking=true;
						break;
					} else {
						ccattr.flags.breaking=false;
					}
				}
			} 
			
			
				
		}
		
		// return true if none (or only the last one)
		// is breaking. returning false will stop
		// recursion down the node.
		return dc==ccnode.ccattrlist.length;
			
		
	},
	
	processAttributesOut	: function(node,ccnode) {
		Circular.debug.write('@engine.processAttributesOut');
		// loop all modules backwards
		// starting with the last break, if any
		for (var dc=0; dc<ccnode.ccattrlist.length; dc++) {
			if (ccnode.ccattrlist[dc].flags.breaking) {
				dc++;
				break;
			}
		}
		for (var dc=dc-1; dc>=0; dc--) {
			var ccattr = ccnode.ccattrlist[dc];
			if (ccattr.props.module) {
				Circular.debug.write('@engine.processAttributesOut','executing',ccattr.props.module);
				var mod = Circular.modules.stack[Circular.modules.name2idx[ccattr.props.module]];
				var func = mod.out;
				if (func) {
					func.call(mod,ccattr,node,ccnode);
				}
			}
		}
		
	},
	
	processChildren	: function(node,context) {
		Circular.debug.write('@engine.processChildren');
		
		// traverse node depth first looking
		// for modules or expressions,
		// using the new context
		var contents = $(node).contents();
		$(contents).each(function() {
			Circular.engine.process(this,context);
		});
		
	},
	
	
	processTextNode	: function(node,ccnode) {
		Circular.debug.write('@engine.processTextNode');
		
		if (ccnode.flags.contentchanged) {
		
			var val = node.textContent;
			var match, exec, nodes = [];
			
			if (this.config.greedy) val=val.trim();
			
			if (matches = Circular.parser.match(val)) {
													
				if (matches.length==1 && matches[0]==val) {
					// this is a full match
					var parent = node.parentNode;
					if (!parent.hasAttribute('cc-content')) {
						Circular.debug.write('@engine.processTextNode','setting cc-content on the parent');
						
						// ugly

						//var parccnode = Circular.registry.get(parent,true);
						//if (parccnode.flags.watched) {
							//if (Circular.watchdog) {
							//	Circular.watchdog.pass(parent,'contentchanged');
							//	Circular.watchdog.pass(parent,'attrsetchanged');
							//}
							//parccnode.flags.attrsetchanged=true;
						//}
						
						// ugly too
						//Circular.queue.add(function() {
						//	parent.setAttribute('cc-content',val);
						//	Circular.engine.recycle(parent);
						//});
						
						Circular.queue.add(function() {
							Circular.watchdog.watch(parent);
							parent.setAttribute('cc-content',val);
						});
						
						// parent.removeChild(node);
						// ah well lets already put the content in.
						// cc-content will come again in 2 rounds
						$(parent).html(Circular.parser.result.call(parent,val,ccnode.props.outercontext));
					
					} else {					
				
						Circular.debug.write('@engine.processTextNode','replacing content with single span');
						var span = document.createElement('span');
						span.setAttribute('id','cc-engine-'+this.genid++);

						span.setAttribute('cc-content',val);
						if (Circular.watchdog) {
							Circular.watchdog.pass(parent,'contentchanged');
						}
						
						parent.insertBefore(span, node);
						parent.removeChild(node);
						this.process(span,ccnode.props.outercontext);
					}

				} else {
				
					// start splitting up nodes
					Circular.debug.write('replacing content with text and spans');
					
					var vals = Circular.parser.split(val);
					for (var vc=0; vc<vals.length;vc++) {
							if (vals[vc].expression) {
								Circular.debug.write('@engine.processTextNode','inserting span '+vals[vc].expression);
								var span = document.createElement('span');
								span.setAttribute('id','cc-engine-'+this.genid++);
								span.setAttribute('cc-content',vals[vc].expression);
								nodes.push(span);
							} else {
								Circular.debug.write('@engine.processTextNode','inserting text '+vals[vc].text);
								nodes.push(document.createTextNode(vals[vc].text));
							}
					}
					
					for (var nc=0; nc < nodes.length; nc++) {
						if (Circular.watchdog) {
							Circular.watchdog.pass(node.parentNode,'contentchanged');
						}
						node.parentNode.insertBefore(nodes[nc], node);
						if (nodes[nc].nodeType==Node.ELEMENT_NODE) {
							this.process(nodes[nc],ccnode.props.outercontext);
						}
					}
					
					node.parentNode.removeChild(node);
					
				}
													
			} else {
				// this text does not contain expressions
			}
		} else {
			// this text hasnt changed
		}
	},
	
	/* node management - unused  */
	
	hide	: function(node,method) {
		if (!method) method = Circular.config.hide;
		if (method=='css') $(node).addClass('cc-engine-hidden');
		else if (method=='dom') this.eject(node,'engine','hide');
	},
	
	show	: function(node,method) {
		if (!method) method = Circular.config.hide;
		if (method=='css') $(node).removeClass('cc-engine-hidden');
		else if (method=='dom') this.inject(node);
	},
	
	eject	: function(node,modname,params) {
	
		if (!modname) modname 	= this.name;
		if (!params) params			= 'eject';
		
		var $ejected = $('#cc-ejected');
		if (!$ejected.size()) {
			$('body').append('<div id="cc-ejected"></div>');
			$ejected = $('#cc-ejected');
		}
		var id = node.getAttribute('id');
		if (id==undefined) {
			id = 'cc-engine-'+this.genid++;
			node.setAttribute('id',id);
		}
		$placeholder = $('<!--@'+modname+'['+JSON.stringify(params)+'][#'+id+']-->');
		$(node).after($placeholder).appendTo($ejected);
		
		this.ejected[id] = $placeholder;
		return id;

	},
	
	inject	: function(node) {
		var id 		= node.getAttribute('id');
		var $placeholder 	= this.ejected[id];
		if ($placeholder) {
			$placeholder.before(node);
			$placeholder.remove();
			delete this.ejected[id];
		} else {
			Circular.log.error('@engine.inject','no placeholder found',id);
		}
	},
	
	detach	: function(node) {
	
	},
	
	attach	: function(node) {
	
	}
	
});