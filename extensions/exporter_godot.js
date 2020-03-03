/*
 *
 * Tiled to Godot exporter
 *
 * patwork@gmail.com
 * https://github.com/patwork/tiled-to-godot-exporter-plugin
 *
 */

/* global tiled, Tile, TextFile, BinaryFile, Uint8Array */

(function () {

    var PLUGIN_NAME = 'Tiled to Godot exporter';
    var PLUGIN_VER = 'v0.1 ALPHA (patwork@gmail.com)';
    var EOL = '\n';
    var QUOT = '"';
    var TILEMAP_OFFSET = 65536;
    var TILESET_OFFSET = 65536;
    var BIT_FLIP_H = (1 << 29);
    var BIT_FLIP_V = (1 << 30);

    // -------------------------------------------------------------------
    function GodotScene(map) {
        this.map = map;
        this.ext_count = 0;
        this.sub_count = 0;
        this.tile_layer_count = 0;
        this.object_layer_count = 0;
        this.tileset_id = 0;
        this.tilesets = {};
        this.lines = [];

        // -------------------------------------------------------------------
        // PNG file width and height
        this._image_info = function (filename) {
            var i, data;
            var pngsig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
            var pngihdr = new Uint8Array([73, 72, 68, 82]);
            var file = new BinaryFile(filename, BinaryFile.ReadOnly);

            // png file signature
            data = new Uint8Array(file.read(8));
            if (data.length != pngsig.length) {
                return null;
            }
            for (i = 0; i < data.length; i++) {
                if (data[i] != pngsig[i]) {
                    return null;
                }
            }

            // chunk size
            data = new Uint8Array(file.read(4));

            // ihdr
            data = new Uint8Array(file.read(4));
            if (data.length != pngihdr.length) {
                return null;
            }
            for (i = 0; i < data.length; i++) {
                if (data[i] != pngihdr[i]) {
                    return null;
                }
            }

            // actual header
            data = new Uint8Array(file.read(9));
            var width = (data[0] << 24) + (data[1] << 16) + (data[2] << 8) + data[3];
            var height = (data[4] << 24) + (data[5] << 16) + (data[6] << 8) + data[7];

            file.close();

            return {
                'width': width,
                'height': height
            };
        };

        // -------------------------------------------------------------------
        // isArray polyfill
        this._is_array = function (val) {
            return Object.prototype.toString.call(val) === '[object Array]';
        };

        // -------------------------------------------------------------------
        // put quotes around strings
        this._quot = function (val) {
            return (typeof (val) == 'number') ? val : QUOT + val + QUOT;
        };

        // -------------------------------------------------------------------
        // data formatter
        this._key_type_val = function (key, type, val) {
            var str;

            if (type == null) {
                if (this._is_array(val)) {
                    str = '[ ' + val.join(', ') + ' ]';
                } else {
                    str = this._quot(val);
                }
            } else {
                str = type + '( ' + (this._is_array(val) ? val.join(', ') : this._quot(val)) + ' )';
            }

            return key + ' = ' + str;
        };

        // -------------------------------------------------------------------
        // resource heading
        this._heading = function (resource_type, dictionary) {
            var keyval = '';

            if (dictionary && Object.keys(dictionary).length) {
                var that = this;
                var arr = Object.keys(dictionary).map(function (key) {
                    return key + '=' + that._quot(dictionary[key]);
                });
                keyval = ' ' + arr.join(' ');
            }

            return '[' + resource_type + keyval + ']';
        };

        // -------------------------------------------------------------------
        // scene descriptor
        this._descriptor = function () {
            return this._heading('gd_scene', {
                'load_steps': this.ext_count + this.sub_count + 1,
                'format': 2
            });
        };

        // -------------------------------------------------------------------
        // calculate tile id
        this._tile_id = function (tile) {
            var region_width = tile.tileset.imageWidth;
            var columns = Math.floor(region_width / tile.width);
            var tile_row = Math.floor(tile.id / columns);
            var tile_col = tile.id - tile_row * columns;
            return tile_row * TILESET_OFFSET + tile_col;
        };

        // -------------------------------------------------------------------
        // convert filename to resource path
        this._res_path = function (filename) {
            var arr = filename.split('/');
            return 'res://' + arr[arr.length - 1];
        };

        // -------------------------------------------------------------------
        // export all tiled tilesets into one godot tileset
        this._export_tilesets = function (tilesets) {
            var i, ts, keys;

            // check tilesets compability with godot
            keys = [];
            for (i = 0; i < tilesets.length; i++) {
                ts = tilesets[i];
                if (ts.image == '') {
                    return 'Image collection tilesets are not supported';
                }
                if (ts.tileSpacing != 0) {
                    return 'Tile spacing is not supported';
                }
                if (ts.margin != 0) {
                    return 'Tile margin is not supported';
                }
                this.tilesets[ts.name] = [i, ts];
                keys.push(ts.name);
            }

            // workaround because of https://github.com/bjorn/tiled/issues/2733
            // this will be hopefully unnecesary after Tiled 1.3.3+
            for (i = 0; i < keys.length; i++) {
                ts = this.tilesets[keys[i]];
                var png = this._image_info(ts[1].image);
                if (!png) {
                    return 'Texture image must be in PNG format';
                }
                ts[1].imageWidth = png.width;
                ts[1].imageHeight = png.height;
            }

            // headings for external resources
            for (i = 0; i < keys.length; i++) {
                ts = this.tilesets[keys[i]];
                this.lines.push(this._heading('ext_resource', {
                    'path': this._res_path(ts[1].image),
                    'type': 'Texture',
                    'id': this.ext_count + ts[0] + 1
                }));
            }
            this.lines.push('');

            // tileset subresource id
            this.sub_count++;
            this.tileset_id = this.sub_count;

            // tileset node heading
            this.lines.push(this._heading('sub_resource', {
                'type': 'TileSet',
                'id': this.tileset_id
            }));

            // tileset node data
            for (i = 0; i < keys.length; i++) {
                ts = this.tilesets[keys[i]];
                this.lines.push(this._key_type_val(i + '/name', null, ts[1].name + ' ' + i));
                this.lines.push(this._key_type_val(i + '/texture', 'ExtResource', this.ext_count + ts[0] + 1));
                this.lines.push(this._key_type_val(i + '/tex_offset', 'Vector2', [0, 0]));
                this.lines.push(this._key_type_val(i + '/modulate', 'Color', [1, 1, 1, 1]));
                this.lines.push(this._key_type_val(i + '/region', 'Rect2', [0, 0, ts[1].imageWidth, ts[1].imageHeight]));
                this.lines.push(this._key_type_val(i + '/tile_mode', null, 2));
                this.lines.push(this._key_type_val(i + '/autotile/icon_coordinate', 'Vector2', [0, 0]));
                this.lines.push(this._key_type_val(i + '/autotile/tile_size', 'Vector2', [ts[1].tileWidth, ts[1].tileHeight]));
                this.lines.push(this._key_type_val(i + '/autotile/spacing', null, 0));
                this.lines.push(this._key_type_val(i + '/autotile/occluder_map', null, []));
                this.lines.push(this._key_type_val(i + '/autotile/navpoly_map', null, []));
                this.lines.push(this._key_type_val(i + '/autotile/priority_map', null, []));
                this.lines.push(this._key_type_val(i + '/autotile/z_index_map', null, []));
                this.lines.push(this._key_type_val(i + '/occluder_offset', 'Vector2', [0, 0]));
                this.lines.push(this._key_type_val(i + '/navigation_offset', 'Vector2', [0, 0]));
                this.lines.push(this._key_type_val(i + '/shapes', null, []));
                this.lines.push(this._key_type_val(i + '/z_index', null, 0));
            }
            this.lines.push('');

            // update external resources counter
            this.ext_count += keys.length;

            return null;
        };

        // -------------------------------------------------------------------
        // export one tile layer
        this._export_tile_layer = function (layer) {
            var x, y;

            // get all tiles from layer
            var tile_data = [];
            for (y = 0; y < layer.height; y++) {
                var offset = y * TILEMAP_OFFSET;
                for (x = 0; x < layer.width; x++) {
                    var tile = layer.tileAt(x, y);
                    if (tile != null) {
                        var ts = tile.tileset;
                        if (!ts || !this.tilesets[ts.name]) {
                            return 'Found tile with unknown tileset on layer ' + layer.name;
                        }
                        var flags = layer.flagsAt(x, y);
                        var flip_h = (flags & Tile.FlippedHorizontally) ? BIT_FLIP_H : 0;
                        var flip_v = (flags & Tile.FlippedVertically) ? BIT_FLIP_V : 0;
                        tile_data.push(offset + x);
                        tile_data.push(this.tilesets[ts.name][0] + flip_h + flip_v);
                        tile_data.push(this._tile_id(tile));
                    }
                }
            }

            // tilemap node heading
            this.tile_layer_count++;
            this.lines.push(this._heading('node', {
                'name': 'TileMap' + (this.tile_layer_count > 1 ? this.tile_layer_count : ''),
                'type': 'TileMap',
                'parent': '.'
            }));

            // tilemap node data
            this.lines.push(this._key_type_val('tile_set', 'SubResource', this.tileset_id));
            this.lines.push(this._key_type_val('cell_size', 'Vector2', [this.map.tileWidth, this.map.tileHeight]));
            this.lines.push(this._key_type_val('format', null, 1));
            this.lines.push(this._key_type_val('tile_data', 'PoolIntArray', tile_data));
            this.lines.push('');

            return null;
        };

        // -------------------------------------------------------------------
        // export one object layer
        this._export_object_layer = function (layer) {

            // object node name
            this.object_layer_count++;
            var node_name = 'StaticBody2D' + (this.object_layer_count > 1 ? this.object_layer_count : '');

            // object node heading
            this.lines.push(this._heading('node', {
                'name': node_name,
                'type': 'StaticBody2D',
                'parent': '.'
            }));

            // TODO object node data
            this.lines.push('; LAYER ' + layer.name);
            this.lines.push('');

            return null;
        };

        // -------------------------------------------------------------------
        // parse through all layers
        this._export_layers = function () {
            var err = null;

            for (var i = 0; i < this.map.layerCount; i++) {
                var layer = this.map.layerAt(i);
                if (layer.isTileLayer) {
                    err = this._export_tile_layer(layer);
                } else if (layer.isObjectLayer) {
                    err = this._export_object_layer(layer);
                }
                if (err) {
                    return err;
                }
            }

            return null;
        };

        // -------------------------------------------------------------------
        // export scene
        this.export = function () {
            var err = null;

            this.lines.push('; ' + PLUGIN_NAME + ' ' + PLUGIN_VER);
            this.lines.push('; ' + tiled.version + ' @ ' + tiled.platform + ' (' + tiled.arch + ')');
            this.lines.push('; ' + new Date().toString());
            this.lines.push('');

            // check if tilesets are present
            var tilesets = this.map.usedTilesets();
            if (!tilesets || !tilesets.length) {
                return 'Map has no tilesets attached';
            }

            // export tilesets
            err = this._export_tilesets(tilesets);
            if (err) {
                return err;
            }

            // root node
            this.lines.push(this._heading('node', {
                'name': 'Root',
                'type': 'Node2D'
            }));
            this.lines.push('');

            // chceck for layers
            if (!this.map.layerCount) {
                return 'Map has no layers';
            }

            // export layers
            err = this._export_layers();
            if (err) {
                return err;
            }

            return null;
        };

        // -------------------------------------------------------------------
        // return scene as string
        this.content = function () {
            return this._descriptor() + EOL + EOL + this.lines.join(EOL);
        };

    }

    // -------------------------------------------------------------------
    // Tiled exporter object
    var godot_map_format = {
        name: 'Godot TileMap Scene',
        extension: 'tscn',

        write: function (map, filename) {

            var scene = new GodotScene(map);
            var err = scene.export();
            if (err) {
                tiled.alert(err, PLUGIN_NAME);
                tiled.error(err);
                return;
            }

            var file = new TextFile(filename, TextFile.WriteOnly);
            file.write(scene.content());
            file.commit();
            file.close();
            tiled.log(filename + ' has been written to disk');

        },

    };

    // -------------------------------------------------------------------
    // register Tiled exporter
    tiled.registerMapFormat('godot', godot_map_format);
    tiled.log(godot_map_format.name + ' exporter successfully registered');

})();

// EoF