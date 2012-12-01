/**
 * Encapsulates the Concept Cloud visualisation.
 *
 * @param {Object} config Config options for this class. Requires height and width
 * @param {Object} data The JSON returned by the server.
 * @constructor
 */
tib.vis.ConceptCloud = function ConceptCloud (config, data) {
    
    var INACTIVE_THEME_COLOUR = '#bbb';

    var orientations = {
        'Messy' : [5, 30, 60],
        'Horizontal' : [0, 0, 0],
        'Vertical' : [0, 0, 90]
    };

    /////////////////
    // Setup class properties
    /////////////////
    // Defaults
    this.bold = false;
    this.italic = false;
    this.fill = d3.scale.category20();
    this.font = 'Trebuchet MS';
    this.fontSize = d3.scale.pow().range([8, 160]);
    this.mode = 'Archimedean';
    this.orientation = orientations['Horizontal'];
    this.colourStyle = 'Basic';
    this.bgStyle = 'White';
    this.webMode = false;
    this.words = [];

    $.extend(this, config);

    var self = this;

    /*
     * Create the data structures need for this vis from the JSON the server returned.
     */
    var initData = function(data) {
        
        var cluster = {};
        var words = [];
        var wordsForName = {};
        var wordNamesForId = {};
        var minSize = null;
        var maxSize = null;
        for (var id in data.markers.concepts) {
            
            var w = data.markers.concepts[id];
            words.push(word = {
                edges: w.mstEdges,
                size: parseInt(w.weight, 10),
                text: w.value,
                themeId: w.themeId,
                themeConnectivity: data.markers.themes[w.themeId].connectivity
            });
            
            if (minSize == null) {
                minSize = maxSize = word.size;
            }
            else {
                minSize = Math.min(minSize, word.size);
                maxSize = Math.max(maxSize, word.size)
            }
            
            // Cluster positioning
            cluster[word.text] = {
                x: w.x * self.width/2,
                y: w.y * self.height/2
            };
            
            // Helper data structures
            wordNamesForId[w.id] = w.value;
            wordsForName[word.text] = word;
        }

        // Sort words by theme
        words.sort(function (a, b) { return b.themeConnectivity - a.themeConnectivity;});

        // Normalise text size and build mst
        var mst = [];
        for (var i = 0; i < words.length; i++) {
            var word = words[i];
            for (var j = 0; j < word.edges.length; j++) {
                var toWordName = wordNamesForId[word.edges[j].to];
                mst.push({
                    x1: cluster[word.text].x,
                    y1: cluster[word.text].y,
                    x2: cluster[toWordName].x,
                    y2: cluster[toWordName].y,
                    sourceName: word.text,
                    targetName: toWordName
                });
            }
        }

        return  {
            cluster: cluster,
            mst: mst,
            sizeDomain: [minSize, maxSize],
            themes: data.markers.themes,
            words: words,
            wordsForName: wordsForName
        };
    };
    $.extend(this, initData(data));
    this.fontSize.domain(this.sizeDomain);

    // Setup some additional font colour options
    var hot = [];
    var medium = [];
    var mild = [];
    for (var i = 0; i < 100; i += 10) {
        var hc = tib.util.hslToRgb(i/100, 1, .7);
        var mc = tib.util.hslToRgb((i+80)%100/100, .8, .55);
        var mlc = tib.util.hslToRgb((i+60)%100/100, .8, .4);
        hot.push("rgb(" + Math.round(hc[0]) + "," + Math.round(hc[1]) + "," + Math.round(hc[2]) + ")");
        medium.push("rgb(" + Math.round(mc[0]) + "," + Math.round(mc[1]) + "," + Math.round(mc[2]) + ")");
        mild.push("rgb(" + Math.round(mlc[0]) + "," + Math.round(mlc[1]) + "," + Math.round(mlc[2]) + ")");
    }
    tib.uic.COLOURS['Hot'] = hot;
    tib.uic.COLOURS['Medium'] = medium;
    tib.uic.COLOURS['Mild'] = mild;

    /**
     * Cleanup all traces of this visualisation.
     */
    this.destroy = function () {
        this.selector.remove();
        $('#vis-menu .cloud-menu').remove();
        $('#vis-help .cloud-help').remove();
    };

    /**
     * Export the cloud/web as PNG data url.
     */
    this.asPNG = function () {
        
        // Use canvas to generate png data
        var canvas = document.createElement("canvas"),
            c = canvas.getContext("2d");

        canvas.width = self.width;
        canvas.height = self.height;
        c.fillStyle = tib.uic.BG_COLOURS[self.bgStyle][0];
        c.fillRect(0, 0, self.width, self.height);
        c.translate(self.width >> 1, self.height >> 1);
        c.scale(1, 1);

        // Links
        this.selector.selectAll('line').each(function (line) {
            c.strokeStyle = tib.uic.BG_COLOURS[self.bgStyle][1];
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(line.x1, line.y1);
            c.lineTo(line.x2, line.y2);
            c.stroke();
            c.closePath();
        });
        
        // Words
        this.selector.selectAll("text").each(function (word) {
            c.save();
            if (self.webMode) {
                c.translate(self.cluster[word.text].x, self.cluster[word.text].y);
            }
            else {
                c.translate(word.x, word.y);
            }
            c.font = d3.select(this).style('font');
            c.rotate(word.rotate * Math.PI / 180);
            c.textAlign = "center";
            c.fillStyle = getColourForWord(word.text);
            c.fillText(word.text, 0, 0);
            c.restore();
        });
        
        return canvas.toDataURL("image/png");
    };

    /**
     * Select the layout mode for the cloud.
     *
     * @param value The string value for the layout desired.
     */
    this.selectMode = function (value) {
        self.mode = value;
        self.draw({forceRedraw: true});
    };
    
    /**
     * Draw the concept cloud visualisation.
     */
    this.draw = function (params) {
        
        var webModeToggled = false;
        if (params && params.webMode != null) {
            this.webMode = params.webMode;
            webModeToggled = true;
        }
        
        if (!this.drawn) {
            $('#' + this.drawTarget).css('width', String(this.width) + 'px');
            this.initMenu();
            this.initHelp();
            self.fisheye = d3.fisheye.circular().radius(110).distortion(3);
        }
        
        if (webModeToggled && this.drawn) {
            // Toggle between web and cloud mode
            this.doWebTransform();
        }
        else if (!this.drawn || params.forceRedraw) {
            // Draw
            generate();
            this.selector.on("mousemove", fisheyeTransform);
            this.drawn = true;
        }
        
        if (webModeToggled) {
            this.updateMenu();
        }
    };
    
    /**
     * Select a font for the cloud.
     * @param {String} font The font name of the desired font
     */
    this.selectFont = function (font) {
        if (font != this.font) {
            this.font = font;
            this.draw({forceRedraw: true});    
        }
    };

    this.selectOrientation = function(orientation) {
        self.orientation = orientations[orientation];
        self.draw({forceRedraw: true});
    };
    
    /**
     * Toggle style attribute (bold, italic).
     * @param name The string style desired. Valid options or 'bold' or 'italic'.
     */
    this.toggleStyle = function (name) {
        name = name.toLowerCase();
        if (name == 'bold' || name == 'italic') {
            this[name] = !this[name];
            if (this.webMode) {
                this.selector.selectAll('text')
                    .style("font-style", this.italic ? 'italic' : 'normal')
                    .style("font-weight", this.bold ? 'bold' : 'normal')
            }
            else {
                this.draw({forceRedraw: true});    
            }
        }
    };
    
    /**
     * Toggle concept web visualisation mode.
     */
    this.doWebTransform = function () {
        
        drawSpanningTreeLinks();
            
        this.selector.selectAll('text').transition()
            .duration(750)
            .style("font-size", function(d) { return getFontSizeStr(d.size); })
            .attr("transform", function(d) {
                var coords = getWordCoords(d);
                return "translate(" + coords.x + ", " + coords.y + ")rotate(" + (self.webMode ? 0 : d.rotate) + ")";
            });
    };
    
    // Draw the links for the MST.
    var drawSpanningTreeLinks = function () {
        
        self.selector.selectAll('line').remove();
        
        if (self.webMode === true) {
            
            // Draw links
            self.selector.selectAll('line').data(self.mst).enter()
                .insert("line", ":first-child")
                    .attr("x1", function (d) { return d.x1 + self.width/2})
                    .attr("y1", function (d) { return d.y1 + self.height/2})
                    .attr("x2", function (d) { return d.x2 + self.width/2})
                    .attr("y2", function (d) { return d.y2 + self.height/2})
                    .style("stroke-width", 1)
                    .style("stroke", tib.uic.BG_COLOURS[self.bgStyle][1])
                    .style("fill", "none");
                  
            // Store linked words on the line
            self.selector.selectAll('line').each(function (d) {
                d.source = self.renderedWords[d.sourceName];
                d.target = self.renderedWords[d.targetName];
                if (!d.source || !d.target) {
                    // Remove links with missing nodes
                    d3.select(this).remove();
                }
            });
        }
    };
    
    // Render the words
    var drawWords = function (words) {
        
        self.renderedWords = {};
        $.each(words, function (i, w) {
            self.renderedWords[w.text] = w; 
        });
        
        self.selector = d3.select('#' + self.drawTarget).append("svg");
        self.selector
            .attr("width", self.width)
            .attr("height", self.height)
            .append("g")
                .selectAll("text")
                .data(words)
                .enter().append("text")
                    .style("font-size", function(d) { return d.size + "px"; })
                    .style("font-family", self.font)
                    .style("font-style", self.italic ? 'italic' : 'normal')
                    .style("font-weight", self.bold ? 'bold' : 'normal')
                    .attr("text-anchor", "middle")
                    .attr("transform", function(d) {
                        var coords = getWordCoords(d);
                        return "translate(" + coords.x + ", " + coords.y + ")rotate(" + (self.webMode ? 0 : d.rotate) + ")";
                    })
                    .text(function(d) { return d.text; });
        
                        
        if (self.webMode) {
            self.selector.selectAll('text').style("font-size", function(d) { return getFontSizeStr(d.size); })
            drawSpanningTreeLinks();
        }
        
        updateColours();
    };
    
    // Perform the fisheye transform
    var fisheyeTransform = function () {
        if (self.webMode) {          
            self.fisheye.focus(d3.mouse(this));
            self.selector.selectAll("text").each(function(d) { d.fisheye = self.fisheye(getWordCoords(d)); })
                .style('font-size', function (d) { return getFontSizeStr(d.size * d.fisheye.z);})
                .attr("transform", function(d) {
                    return "translate(" + d.fisheye.x + ", " + d.fisheye.y + ")";
                });
                
            self.selector.selectAll("line")
                .attr("x1", function(d) { return d.source.fisheye.x; })
                .attr("y1", function(d) { return d.source.fisheye.y; })
                .attr("x2", function(d) { return d.target.fisheye.x; })
                .attr("y2", function(d) { return d.target.fisheye.y; });
        }
    };
    
    // Start the D3 drawing process
    var generate = function () {
        
        if (self.selector) {
            self.selector.remove();
        }
        
        self.layout = d3.layout.cloud().size([self.width, self.height])
            .words(self.words)
            .rotate(function() { return ~~(Math.random() * self.orientation[0]) * self.orientation[1] - self.orientation[2]; })
            .spiral(self.mode.toLowerCase())
            .font(self.font)
            .fontSize(function(d) { return self.fontSize(+d.size); })
            .fontStyle(self.italic ? 'italic' : '')
            .fontWeight(self.bold ? 'bold' : 'normal')
            .on("end", drawWords)
            .start();
    };
    
    // Determine colour for the specified word
    var getColourForWord = function (text) {
        return self.themeColours[self.wordsForName[text].themeId];
    };
    
    // Determine font style attribute
    var getFontSizeStr = function (originalSize) {
        return (self.webMode ? 2 + 3 * Math.sqrt(originalSize) : originalSize) + 'px';
    };
    
    // Get x & y coords for word
    var getWordCoords = function (d) {
        var x = self.webMode ? self.cluster[d.text].x : d.x;
        var y = self.webMode ? self.cluster[d.text].y : d.y;
        x = x + self.width/2;
        y = y + self.height/2;    
        return {x: x, y: y};
    };
    
    // Update colours
    var updateColours = function () {

        var colours = tib.uic.COLOURS[self.colourStyle];
        self.themeColours = {};
        var themeCount = 0;
        for (var id in self.themes) {

            // Truncate colourisation of themes by connectivity
            if (themeCount < colours.length) {
                self.themeColours[id] = colours[themeCount];
            }
            else {
                self.themeColours[id] = INACTIVE_THEME_COLOUR;
            }
            themeCount = themeCount + 1;
        }

        self.selector.selectAll('text').style("fill", function(d) { return getColourForWord(d.text); })
    };

    // Update background colour
    var updateBackgroundColour = function () {
        self.selector.style("background-color", tib.uic.BG_COLOURS[self.bgStyle][0]);
        self.selector.selectAll('line').style("stroke", tib.uic.BG_COLOURS[self.bgStyle][1])
        $('#' + self.drawTarget).css("background-color", tib.uic.BG_COLOURS[self.bgStyle][0]);
    };

    /**
     * Initialise the menu for this vis. This method injects the menu into the corrext place.
     */
    this.initMenu = function () {

        // Top level menu
        var menuContainer = $('#vis-menu');

        /* Build the menu - last has to come first to preserve the share button */
        // Colour selection
        $(menuContainer).prepend('<li class="cloud-menu dropdown" id="cloud-menu-colours"><a class="dropdown-toggle" data-toggle="dropdown" href="#">Colours<b class="caret"></b></a><ul class="dropdown-menu"></ul></li>');
        var coloursMenu = $('#cloud-menu-colours ul');
        // Background colouring
        coloursMenu.append($('<li class="nav-header">Background Colours</li>'));
        $.each(tib.uic.BG_COLOURS, function (key, value) {
            var listEl = $('<li class="bg-colour"><a href="#">' + key + '</a></li>');
            // Click handler
            listEl.click(function(e) {
                e.preventDefault();
                self.bgStyle = key;
                updateBackgroundColour();
                $('#cloud-menu-colours li.bg-colour').removeClass('active');
                listEl.addClass('active');
            });

            if (key == self.bgStyle) {
                listEl.addClass('active')
            }
            coloursMenu.append(listEl);
        });
        // Theme colouring
        coloursMenu.append($('<li class="nav-header">Theme Colours</li>'));
        $.each(tib.uic.COLOURS, function (key, value) {
            // Build colour icons
            var colours = '';
            var ellipsis = false ;
            $.each(value, function (index, val) {
                if (index === 10) {
                    ellipsis = true;
                    return false;
                }
                colours += '<i class="icon-sign-blank" style="color: ' + val + ';"></i>';
            });
            var listEl = $('<li class="colour"><a href="#">' + colours + (ellipsis ? '...' : '') + '</a></li>');
            // Click handler
            listEl.click(function(e) {
                e.preventDefault();
                self.colourStyle = key;
                updateColours();
                $('#cloud-menu-colours li.colour').removeClass('active');
                listEl.addClass('active');
            });

            if (key == self.colourStyle) {
                listEl.addClass('active')
            }
            coloursMenu.append(listEl);
        });

        // Layout selection
        $(menuContainer).prepend('<li class="cloud-menu dropdown" id="cloud-menu-layout"><a class="dropdown-toggle" data-toggle="dropdown" href="#">Layout<b class="caret"></b></a><ul class="dropdown-menu" id="cloud-menu-layout"></ul></li>');
        var layoutMenu = $('#cloud-menu-layout ul');
        // Mode options
        layoutMenu.append($('<li class="nav-header">Cloud Shape</li>'));
        $(['Archimedean', 'Rectangular']).each(function (i, mode) {
            var listEl = $('<li class="mode"><a href="#">' + mode.replace('Archimedean', 'Circular') + '</a></li>');
            // Click handler
            listEl.click(function(e) {
                e.preventDefault();
                self.selectMode(mode);
                $('ul#cloud-menu-layout li.mode').removeClass('active');
                listEl.addClass('active');
            });
            if (mode == self.mode) {
                listEl.addClass('active')
            }
            layoutMenu.append(listEl);
        });
        // Orientation options
        layoutMenu.append($('<li class="nav-header">Word Orientation</li>'));
        $.each(orientations, function (key, value) {
            var listEl = $('<li class="orientation"><a href="#">' + key + '</a></li>');
            // Click handler
            listEl.click(function(e) {
                e.preventDefault();
                self.selectOrientation(key);
                $('ul#cloud-menu-layout li.orientation').removeClass('active');
                listEl.addClass('active');
            });

            if (value == self.orientation) {
                listEl.addClass('active')
            }
            layoutMenu.append(listEl);
        });

        // Font selection
        $(menuContainer).prepend('<li class="cloud-menu dropdown"><a class="dropdown-toggle" data-toggle="dropdown" href="#">Font<b class="caret"></b></a><ul class="dropdown-menu" id="cloud-menu-text"></ul></li>');
        var fontMenu = $('ul#cloud-menu-text');
        // Style options
        fontMenu.append($('<li class="nav-header">Style</li>'));
        $('<li class="style"><a href="#" style="font-weight:bold">Bold</a></li>').appendTo(fontMenu)
            // Click handler
            .click(function(e) {
                e.preventDefault();
                // This is set to the event target
                $(this).toggleClass('active');
                self.toggleStyle('bold');
            });
        $('<li class="style"><a href="#" style="font-weight:bold">Italic</a></li>').appendTo(fontMenu)
            // Click handler
            .click(function(e) {
                e.preventDefault();
                $(this).toggleClass('active');
                self.toggleStyle('italic');
            });
        // Font Family options
        fontMenu.append('<li class="nav-header">Font</li>');
        $(tib.uic.FONTS).each(function (i, font) {
            var listEl = $('<li class="font"><a href="#" style="font-family:' + font + '">' + font + '</a></li>');
            // Click handler
            listEl.click(function(e) {
                e.preventDefault();
                self.selectFont(font);
                $('ul#cloud-menu-text li.font').removeClass('active');
                listEl.addClass('active');
            });
            // Make sure the current font is set as active.
            if (font == self.font) {
                listEl.addClass('active');
            }
            fontMenu.append(listEl);
        });

        // Refresh button
        $('<li class="cloud-menu" id="cloud-menu-refresh"><a href="#">Refresh</a></li>').prependTo(menuContainer)
            .click(function(e) {
                e.preventDefault();
                self.draw({forceRedraw: true});
            });
    };

    // Create the body content for the help modal.
    this.initHelp = function () {

        // Place to inject
        var visContainer = $('#vis-help .modal-body');
        var modal = '';
        if (self.webMode === true) {
            modal +=
                '<h3>Concept Web</h3>'+
                '<p>This is where you really see the power of the text analytics provided by <a href="http://leximancer.com" target="_blank">Leximancer</a>.</p>'+
                '<p>In this visualisation, the position of concepts matter. Concepts that are more realted will appear near each other. Concepts that aren\'t very related will appear futher apart.</p>'+
                '<p>As with the Concept Cloud, related concepts are grouped into <em>themes</em>. Themes are denoted by colour.</p>' +
                '<p>There is one cavaet with theme colouring you should be aware of. The number of themes identified by Leximancer depends on the number of concepts found which in turn depends on your text. The available colour schemse define between 8 and 10 colours. If there are are more themes then there is colours in your selected scheme, the remaining themes will be coloured grey. This can cause confusion with colour schemes them themselves contain grey.</p>';

        }
        else {
            modal +=
                '<h3>Concept Cloud</h3>'+
                '<p>This visualisation is inspired by Wordle but it has a little <a href="http://leximancer.com" target="_blank">Leximancer</a> magic sprinkled on top.</p>'+
                '<p>In this visualisation, the concepts are positioned randomly to keep the visualisation nice and compact. The size of a concept dentones how frequent it is within the text.</p>'+
                '<p>Unlike Wordle, the Concept Cloud groups concepts into <em>themes</em>. Themes are denoted by colour. Concepts that have the same colour belong to the same theme and are cloesly related. You can select the colours you want to use under the colour menu. Some colours work better with the Concept Cloud, others work better with the Concept Web.</p>' +
                '<p>There is one cavaet with theme colouring you should be aware of. The number of themes identified by Leximancer depends on the number of concepts found which in turn depends on your text. The available colour schemse define between 8 and 10 colours. If there are are more themes then there is colours in your selected scheme, the remaining themes will be coloured grey. This can cause confusion with colour schemes them themselves contain grey.</p>';
        }
        visContainer.append(modal);
    };

    // Update the menus based on web or cloud mode
    this.updateMenu = function () {
        $('#vis-types li').removeClass('active');
        if (this.webMode === true) {
            $('#cloud-menu-layout').hide();
            $('#cloud-menu-refresh').hide();
            $('#vis-types li.web').addClass('active');
            
        }
        else {
            $('#cloud-menu-layout').show();
            $('#cloud-menu-refresh').show();
            $('#vis-types li.cloud').addClass('active');
        }
    };

    return this;
};