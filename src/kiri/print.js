/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

(function() {

    if (self.kiri.newPrint) return;

    const KIRI = self.kiri,
        DRIVERS = KIRI.driver,
        LASER = DRIVERS.LASER,
        CAM = DRIVERS.CAM,
        FDM = DRIVERS.FDM,
        BASE = self.base,
        UTIL = BASE.util,
        DBUG = BASE.debug,
        POLY = BASE.polygons,
        SQRT = Math.sqrt,
        SQR = UTIL.sqr,
        PI = Math.PI,
        PRO = Print.prototype,
        Polygon = BASE.Polygon,
        newPoint = BASE.newPoint;

    let lastPoint = null,
        lastEmit = null;

    KIRI.Print = Print;

    KIRI.newPrint = function(settings, widgets, id) {
        return new Print(settings, widgets, id);
    };

    /**
     * @param {Object} settings
     * @param {Widget[]} widgets
     * @constructor
     */
    function Print(settings, widgets, id) {
        this.id = id || new Date().getTime().toString(36);

        this.settings = settings;
        this.widgets = widgets;
        // this.group = new THREE.Group();
        this.printView = [];
        this.movesView = [];

        this.time = 0;
        this.lines = 0;
        this.bytes = 0;
        this.output = null;
        this.distance = 0;
        this.bounds = null;
        this.imported = null;

        // this.hsv2rgb = hsv2rgb;
    }

    Print.hsv2rgb = hsv2rgb;

    PRO.addOutput = addOutput;
    PRO.tip2tipEmit = tip2tipEmit;
    PRO.extrudePerMM = extrudePerMM;
    PRO.constReplace = constReplace;
    PRO.poly2polyEmit = poly2polyEmit;
    PRO.addPrintPoints = addPrintPoints;

    PRO.parseSVG = function(code, offset) {
        let scope = this,
            svg = new DOMParser().parseFromString(code, 'text/xml'),
            lines = [...svg.getElementsByTagName('polyline')],
            output = scope.output = [],
            bounds = scope.bounds = {
                max: { x:-Infinity, y:-Infinity, z:-Infinity},
                min: { x:Infinity, y:Infinity, z:Infinity}
            };
        lines.forEach(line => {
            let seq = [];
            let points = [...line.points];
            points.forEach(point => {
                if (offset) {
                    point.x += offset.x;
                    point.y += offset.y;
                }
                if (point.x) bounds.min.x = Math.min(bounds.min.x, point.x);
                if (point.x) bounds.max.x = Math.max(bounds.max.x, point.x);
                if (point.y) bounds.min.y = Math.min(bounds.min.y, point.y);
                if (point.y) bounds.max.y = Math.max(bounds.max.y, point.y);
                if (point.z) bounds.min.z = Math.min(bounds.min.z, point.z);
                if (point.z) bounds.max.z = Math.max(bounds.max.z, point.z);
                addOutput(seq, point, seq.length > 0);
            });
            output.push(seq);
        });
        scope.imported = code;
        scope.lines = lines.length;
        scope.bytes = code.length;
    };

    PRO.parseGCode = function(gcode, offset) {
        let lines = gcode
            .toUpperCase()
            .replace("X", " X")
            .replace("Y", " Y")
            .replace("Z", " Z")
            .replace("E", " E")
            .replace("F", " F")
            .replace("  ", " ")
            .split("\n");

        let scope = this,
            output = scope.output = [],
            bounds = scope.bounds = {
                max: { x:-Infinity, y:-Infinity, z:-Infinity},
                min: { x:Infinity, y:Infinity, z:Infinity}
            },
            seq = [],
            abs = true,
            move = false,
            factor = 1,
            tool = 0,
            E0G0 = false,
            G0 = function() {
                move = true;
                if (seq.length > 0) {
                    output.push(seq);
                    seq = [];
                }
            },
            LZ = 0.0,
            pos = {
                X: 0.0,
                Y: 0.0,
                Z: 0.0,
                F: 0.0,
                E: 0.0
            },
            off = {
                X: offset ? offset.x || 0 : 0,
                Y: offset ? offset.y || 0 : 0,
                Z: offset ? offset.z || 0 : 0
            },
            xoff = {
                X: 0,
                Y: 0,
                Z: 0
            };

        lines.forEach(function(line) {
            line = line.split(";")[0].split(" ");
            let cmd = line.shift();
            if (cmd.charAt(0) === 'T') {
                let ext = scope.settings.device.extruders;
                let pos = parseInt(cmd.charAt(1));
                if (ext && ext[pos]) {
                    xoff.X = -ext[pos].extOffsetX;
                    xoff.Y = -ext[pos].extOffsetY;
                }
            }
            switch (cmd) {
                case 'G20':
                    factor = 25.4;
                    break;
                case 'G21':
                    factor = 1;
                    break;
                case 'G90':
                    // absolute positioning
                    abs = true;
                    break;
                case 'G91':
                    // relative positioning
                    abs = false;
                    break;
                case 'G0':
                    G0();
                case 'G1':
                    line.forEach(function(tok) {
                        pos[tok.charAt(0)] = parseFloat(tok.substring(1));
                    });
                    if (pos.X) bounds.min.x = Math.min(bounds.min.x, pos.X * factor);
                    if (pos.X) bounds.max.x = Math.max(bounds.max.x, pos.X * factor);
                    if (pos.Y) bounds.min.y = Math.min(bounds.min.y, pos.Y * factor);
                    if (pos.Y) bounds.max.y = Math.max(bounds.max.y, pos.Y * factor);
                    if (pos.Z) bounds.min.z = Math.min(bounds.min.z, pos.Z * factor);
                    if (pos.Z) bounds.max.z = Math.max(bounds.max.z, pos.Z * factor);
                    if (pos.E) E0G0 = true;
                    if (E0G0 && pos.E === 0.0) {
                        if (LZ != pos.Z) G0();
                        else move = true;
                    }
                    addOutput(
                        seq,
                        {
                            x:(factor * pos.X + off.X + xoff.X),
                            y:(factor * pos.Y + off.Y + xoff.Y),
                            z:(factor * pos.Z + off.Z + xoff.Z)
                        },
                        !move,
                        pos.F,
                        tool
                    );
                    break;
                case 'M6':
                    break;
            }
            move = false;
            pos.E = 0.0;
            LZ = pos.Z;
        });

        G0();

        scope.imported = gcode;
        scope.lines = lines.length;
        scope.bytes = gcode.length;
    };

    function pref(a,b) {
        return a !== undefined ? a : b;
    }

    function rgb2hsv(ir, ig, ib) {
        let H = 0,
            S = 0,
            V = 0,
            r = ir / 255,
            g = ig / 255,
            b = ib / 255;

        let minRGB = Math.min(r, Math.min(g, b)),
            maxRGB = Math.max(r, Math.max(g, b));

        // Black-gray-white
        if (minRGB == maxRGB) {
            V = minRGB;
            return [0, 0, V];
        }

        // Colors other than black-gray-white:
        let d = (r == minRGB) ? g - b : ((b == minRGB) ? r - g : b - r),
            h = (r == minRGB) ? 3 : ((b == minRGB) ? 1 : 5);

        H = 60 * (h - d / (maxRGB - minRGB));
        S = (maxRGB - minRGB) / maxRGB;
        V = maxRGB;

        return [H, S, V];
    }

    function hsl2rgb(h, s, l) {
        let r, g, b;

        if (s == 0) {
            r = g = b = l; // achromatic
        } else {
            let hue2rgb = function hue2rgb(p, q, t) {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            }

            let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            let p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }

        const rgb =
            (((r * 255) & 0xff) << 16) |
            (((g * 255) & 0xff) << 8) |
             ((b * 255) & 0xff);

        return rgb;
    }

    // hsv values all = 0 to 1
    function hsv2rgb(hsv, hex) {
        let seg  = Math.floor(hsv.h * 6),
            rem  = hsv.h - (seg * (1/6)),
            p = hsv.v * (1.0 - (hsv.s)),
            q = hsv.v * (1.0 - (hsv.s * rem)),
            t = hsv.v * (1.0 - (hsv.s * (1.0 - rem))),
            out = {};
        switch (seg) {
            case 0:
                out.r = hsv.v;
                out.g = t;
                out.b = p;
                break;
            case 1:
                out.r = q;
                out.g = hsv.v;
                out.b = p;
                break;
            case 2:
                out.r = p;
                out.g = hsv.v;
                out.b = t;
                break;
            case 3:
                out.r = p;
                out.g = q;
                out.b = hsv.v;
                break;
            case 4:
                out.r = t;
                out.g = p;
                out.b = hsv.v;
                break;
            case 5:
                out.r = hsv.v;
                out.g = p;
                out.b = q;
                break;
        }

        // if (hex) return hsl2rgb(hsv.h, hsv.s, hsv.v);

        return hex ? (
            (((out.r * 255) & 0xff) << 16) |
            (((out.g * 255) & 0xff) << 8) |
             ((out.b * 255) & 0xff)
        ) : out;
    }

    // PRO.getLayerCount = function() {
    //     return this.output.length;
    // }

    // PRO.hide = function() {
    //     this.printView.forEach(function(layer) {
    //         layer.setVisible(false);
    //     })
    //     this.movesView.forEach(function(layer) {
    //         layer.setVisible(false);
    //     })
    // };
    //
    // PRO.showLayer = function(index, show, moves) {
    //     if (this.printView[index]) this.printView[index].setVisible(show);
    //     if (this.movesView[index]) this.movesView[index].setVisible(show && moves);
    // };

    /**
     * @constructor
     */
    function Output(point, emit, speed, tool) {
        this.point = point; // point to emit
        this.emit = emit; // emit (feed for printers, power for lasers, cut for cam)
        this.speed = speed;
        this.tool = tool;
    }

    /**
     * @param {Point[]} array of points
     * @param {Point} point
     * @param {number} emit (0=move, !0=filament emit/laser on/cut mode)
     * @param {number} [speed] speed
     * @param {number} [tool] tool # or nozzle #
     */
    function addOutput(array, point, emit, speed, tool) {
        // drop duplicates (usually intruced by FDM bisections)
        if (lastPoint && point) {
            // nested due to uglify confusing browser
            if (point.x == lastPoint.x && point.y == lastPoint.y && point.z == lastPoint.z && lastEmit == emit) {
                return;
            }
        }
        lastPoint = point;
        lastEmit = emit;
        array.push(new Output(point, emit, speed, tool));
    }

    // function segmentedOutput(output, p1, p2, s1, s2, steps, mult) {
    //     let sd = (s2 - s1) / (steps + 1);
    //     let dd = p1.distTo2D(p2) / steps;
    //     let dist = dd;
    //     let spd = s1;
    //     while (steps-- > 0) {
    //         spd += sd;
    //         p1 = p1.offsetPointTo(p2, dd);
    //         addOutput(output, p1, mult, spd);
    //     }
    // }

    /**
     * FDM & Laser. add points in polygon to an output array (print path)
     *
     * @param {Polygon} poly
     * @param {Point} startPoint
     * @param {Array} output
     * @param {number} [extrude] multiplier
     * @param {Function} [onfirst] optional fn to call on first point
     * @return {Point} last output point
     */
    PRO.polyPrintPath = function(poly, startPoint, output, opt) {
        poly.setClockwise();

        let options = opt || {},
            process = this.settings.process,
            shortDist = process.outputShortDistance,
            shellMult = pref(options.extrude, process.outputShellMult),
            printSpeed = options.rate || process.outputFeedrate,
            moveSpeed = process.outputSeekrate,
            minSpeed = process.outputMinSpeed,
            closest = options.simple ? poly.first() : poly.findClosestPointTo(startPoint),
            perimeter = poly.perimeter(),
            first = true,
            close = !options.open,
            last = startPoint,
            wipeDist = options.wipe || 0,
            coastDist = options.coast || 0,
            tool = options.tool;

        // if short, use calculated print speed based on sliding scale
        if (perimeter < process.outputShortPoly) {
            printSpeed = minSpeed + (printSpeed - minSpeed) * (perimeter / process.outputShortPoly);
        }

        poly.forEachPoint(function(point, pos, points, count) {
            if (first) {
                if (options.onfirst) {
                    options.onfirst(point);
                }
                // move from startPoint to point
                addOutput(output, point, 0, moveSpeed, tool);
                first = false;
            } else {
                let seglen = last.distTo2D(point);
                if (coastDist && shellMult && perimeter - seglen <= coastDist) {
                    let delta = perimeter - coastDist;
                    let offset = seglen - delta;
                    let offPoint = last.offsetPointFrom(point, offset)
                    addOutput(output, offPoint, shellMult, printSpeed, tool);
                    shellMult = 0;
                }
                perimeter -= seglen;
                addOutput(output, point, shellMult, printSpeed, tool);
            }
            last = point;
        }, close, closest.index);

        return output.last().point;
    };

    /**
     * FDM only. create 3d print output path for this slice
     *
     * @parma {Slice} slice
     * @param {Point} startPoint start as close as possible to startPoint
     * @param {THREE.Vector3} offset
     * @param {Point[]} output points
     * @param {Object} [options] object
     * @return {Point} last output point
     */
    PRO.slicePrintPath = function(slice, startPoint, offset, output, options) {
        // console.log({slicePrintPath: slice.index, ext:slice.extruder});

        let i,
            opt = options || {},
            preout = [],
            scope = this,
            settings = this.settings,
            process = settings.process,
            extruder = slice.extruder || 0,
            nozzleSize = settings.device.extruders[extruder].extNozzle,
            firstLayer = opt.first || false,
            minSeek = nozzleSize * (opt.minSeek || 1.5),
            thinWall = nozzleSize * (opt.thinWall || 1.75),
            retractDist = opt.retractOver || 2,
            fillMult = opt.mult || process.outputFillMult,
            shellMult = opt.mult || process.outputShellMult || (process.laserSliceHeight >= 0 ? 1 : 0),
            sparseMult = process.outputSparseMult,
            coastDist = process.outputCoastDist || 0,
            finishSpeed = opt.speed || process.outputFinishrate,
            firstShellSpeed = process.firstLayerRate,
            firstFillSpeed = process.firstLayerFillRate,
            firstPrintMult = process.firstLayerPrintMult,
            printSpeed = opt.speed || (firstLayer ? firstShellSpeed : process.outputFeedrate),
            fillSpeed = opt.speed || opt.fillSpeed || (firstLayer ? firstFillSpeed || firstShellSpeed : process.outputFeedrate),
            moveSpeed = process.outputSeekrate,
            origin = startPoint.add(offset),
            zhop = process.zHopDistance || 0,
            antiBacklash = process.antiBacklash,
            doSupport = opt.support,
            z = slice.z;

        // apply first layer extrusion multipliers
        if (firstLayer) {
            fillMult *= firstPrintMult;
            shellMult *= firstPrintMult;
            sparseMult *= firstPrintMult;
        }

        function retract() {
            if (preout.length) preout.last().retract = true;
        }

        function intersectsTop(p1, p2) {
            let int = false;
            POLY.flatten(slice.topPolys().clone(true)).forEach(function(poly) {
                if (!int) poly.forEachSegment(function(s1, s2) {
                    if (UTIL.intersect(p1,p2,s1,s2,BASE.key.SEGINT)) {
                        int = true;
                        return int;
                    }
                });
            });
            return int;
        }

        function outputTraces(poly, extrude) {
            if (!poly) return;
            if (Array.isArray(poly)) {
                outputOrderClosest(poly, function(next) {
                    outputTraces(next, extrude);
                }, null);
            } else {
                let finishShell = poly.depth === 0 && !firstLayer;
                startPoint = scope.polyPrintPath(poly, startPoint, preout, {
                    tool: extruder,
                    rate: finishShell ? finishSpeed : printSpeed,
                    accel: finishShell,
                    wipe: process.outputWipeDistance || 0,
                    coast: firstLayer ? 0 : coastDist,
                    extrude: pref(extrude, shellMult),
                    onfirst: function(firstPoint) {
                        if (startPoint.distTo2D(firstPoint) > retractDist) {
                            retract();
                        }
                    }
                });
            }
        }

        /**
         * @param {Polygon[]} polys
         */
        function outputSparse(polys, extrude, speed) {
            if (!polys) return;
            let proxy = polys.map(function(poly) {
                return {poly: poly, first: poly.first(), last: poly.last()};
            });
            let lp = startPoint;
            startPoint = tip2tipEmit(proxy, startPoint, function(el, point, count) {
                let poly = el.poly;
                if (poly.last() === point) {
                    poly.reverse();
                }
                poly.forEachPoint(function(p, i) {
                    // retract if dist trigger and crosses a slice top polygon
                    if (i === 0 && lp && lp.distTo2D(p) > retractDist && intersectsTop(lp,p)) {
                        retract();
                    }
                    addOutput(preout, p, i === 0 ? 0 : extrude, speed || printSpeed, extruder);
                    lp = p;
                });
                return lp;
            });
        }

        function outputFills(lines, options) {
            if (!lines || lines.length === 0) {
                return;
            }
            let p, p1, p2, dist, len, found, group, mindist, t1, t2,
                marked = 0,
                start = 0,
                skip = false,
                lastIndex = -1,
                opt = options || {},
                near = opt.near || false,
                fast = opt.fast || false,
                fill = opt.fill >= 0 ? opt.fill : fillMult,
                thinDist = near ? thinWall : thinWall;

            while (lines && marked < lines.length) {
                group = null;
                found = false;
                mindist = Infinity;

                // use next nearest line strategy
                if (near)
                for (i=0; i<lines.length; i += 2) {
                    t1 = lines[i];
                    if (t1.del) {
                        continue;
                    }
                    t2 = lines[i+1];
                    let d1 = t1.distToSq2D(startPoint);
                    let d2 = t2.distToSq2D(startPoint);
                    if (d1 < mindist || d2 < mindist) {
                        if (d2 < d1) {
                            p2 = t1;
                            p1 = t2;
                        } else {
                            p1 = t1;
                            p2 = t2;
                        }
                        mindist = Math.min(d1, d2);
                        lastIndex = i;
                    }
                }

                // use next index line strategy
                // order all points by distance to last point
                if (!near)
                for (i=start; i<lines.length; i += 2) {
                    p = lines[i];
                    if (p.del) {
                        continue;
                    }
                    if (group === null && p.index > lastIndex) {
                        group = p.index;
                    }
                    if (group !== null) {
                        if (p.index !== group) {
                            break;
                        }
                        if (p.index % 2 === 0) {
                            t1 = lines[i];
                            t2 = lines[i+1];
                        } else {
                            t2 = lines[i];
                            t1 = lines[i+1];
                        }
                        dist = Math.min(t1.distTo2D(startPoint), t2.distTo2D(startPoint));
                        if (dist < mindist) {
                            p1 = t1;
                            p2 = t2;
                            mindist = dist;
                        }
                        start = i;
                        found = true;
                    }
                }

                // go back to start and try again
                if (!near && !found) {
                    if (start === 0 && lastIndex === -1) {
                        console.log('infinite loop', lines, {
                            marked, options, i, group, start, lastIndex,
                            points: lines.map(p => p.index).join(', ')
                        });
                        break;
                    }
                    start = 0;
                    lastIndex = -1;
                    continue;
                }

                dist = startPoint.distToSq2D(p1);
                len = p1.distToSq2D(p2);

                // go back to start when dist > retractDist
                if (!near && !fast && !skip && dist > retractDist) {
                    skip = true;
                    start = 0;
                    lastIndex = -1;
                    continue;
                }
                skip = false;

                // mark as used (temporarily)
                p1.del = true;
                p2.del = true;
                marked += 2;
                lastIndex = p1.index;

                // if dist to new segment is less than thinWall
                // and segment length is less than thinWall then
                // just extrude to midpoint of next segment. this is
                // to avoid shaking the printer to death.
                if (dist <= thinDist && len <= thinDist) {
                    p2 = p1.midPointTo(p2);
                    addOutput(preout, p2, fill * (dist / thinWall), fillSpeed, extruder);
                } else {
                    // retract if dist trigger or crosses a slice top polygon
                    if (!fast && dist > retractDist && (zhop || intersectsTop(startPoint, p1))) {
                        retract();
                    }

                    // anti-backlash on longer move
                    if (!fast && antiBacklash && dist > retractDist) {
                        addOutput(preout, p1.add({x:antiBacklash,y:-antiBacklash,z:0}), 0, moveSpeed, extruder);
                    }

                    // bridge ends of fill when they're close together
                    if (dist < thinDist) {
                        addOutput(preout, p1, fill, fillSpeed, extruder);
                    } else {
                        addOutput(preout, p1, 0, moveSpeed, extruder);
                    }

                    addOutput(preout, p2, fill, fillSpeed, extruder);
                }

                startPoint = p2;
            }

            // clear delete marks so we can re-print later
            if (lines) lines.forEach(function(p) { p.del = false });
        }

        /**
         * given array of polygons, emit them in next closest order with
         * the special exception that depth is considered into distance
         * so that inner polygons are emitted first.
         *
         * @param {Array} array of Polygon or Polygon wrappers
         * @param {Function} fn
         * @param {Function} fnp convert 'next' object into a Polygon
         */
        function outputOrderClosest(array, fn, fnp, newTop) {
            if (array.length === 1) {
                return fn(array[0]);
            }
            array = array.slice();
            let closest, find, next, order, poly, lastDepth = 0;
            for (;;) {
                order = [];
                closest = null;
                for (i=0; i<array.length; i++) {
                    next = array[i];
                    if (!next) continue;
                    poly = fnp ? fnp(next) : next;
                    find = poly.findClosestPointTo(startPoint);
                    order.push({
                        i: i,
                        n: next,
                        d: find.distance - (poly.depth * thinWall),
                    });
                }
                newTop = false;
                if (order.length === 0) {
                    return;
                }
                order.sort(function(a,b) {
                    return a.d - b.d;
                });
                array[order[0].i] = null;
                fn(order[0].n);
            }
        }

        let out = [];
        if (slice.tops) {
            out.appendAll(slice.tops);
        };
        if (opt.support && slice.supports) {
            out.appendAll(slice.supports);
        }

        let lastTop = null;
        outputOrderClosest(out, function(next) {
            if (next instanceof Polygon) {
                // support polygon
                next.setZ(z);
                outputTraces([next].appendAll(next.inner || []));
                if (next.fills) {
                    next.fills.forEach(function(p) { p.z = z });
                    outputFills(next.fills, {fast: true});
                }
            } else {
                // top object
                let bounds = POLY.flatten(next.shellsAtDepth(0).clone(true));

                let dir = -1; // 1 == inside out, -1 == outside-in

                // output inner polygons
                if (dir === 1)
                outputTraces([].appendAll(next.innerShells() || []));

                // sort perimeter polygon by length to go out-to-in or in-to-out
                (next.shells || []).sort(function(a,b) {
                    return a.perimeter() > b.perimeter() ? dir : -dir;
                }).forEach(function(poly, index) {
                    outputTraces(poly);
                });

                // output outer polygons
                if (dir === -1)
                outputTraces([].appendAll(next.innerShells() || []));

                // output thin fill
                outputFills(next.thin_fill, {near: true});

                // then output solid and sparse fill
                outputFills(next.fill_lines);
                outputSparse(next.fill_sparse, sparseMult);

                lastTop = next;
            }
        }, function(obj) {
            return obj instanceof Polygon ? obj : obj.poly;
        });

        // produce polishing paths when present
        if (slice.tops.length && slice.tops[0].polish) {
            let {x,y} = slice.tops[0].polish;
            if (x) {
                outputSparse(x, 0, process.polishSpeed);
            }
            if (y) {
                outputSparse(y, 0, process.polishSpeed);
            }
        }

        // offset print points
        for (i=0; i<preout.length; i++) {
            preout[i].point = preout[i].point.add(offset);
        }

        // add offset points to total print
        addPrintPoints(preout, output, origin, extruder);

        return startPoint.add(offset);
    };

    /**
     *
     * @param {Output[]} input
     * @param {Point[]} output
     * @param {Point} [startPoint]
     */
    function addPrintPoints(input, output, startPoint, tool) {
        if (startPoint && input.length > 0) {
            addOutput(output, startPoint, 0, undefined, tool);
        }
        output.appendAll(input);
    }

    /**
     * emit each element in an array based on
     * the next closest endpoint.
     */
    function tip2tipEmit(array, startPoint, emitter) {
        let mindist, dist, found, count = 0;
        for (;;) {
            found = null;
            mindist = Infinity;
            array.forEach(function(el) {
                if (el.delete) return;
                dist = startPoint.distTo3D(el.first);
                if (dist < mindist) {
                    found = {el:el, first:el.first, last:el.last};
                    mindist = dist;
                }
                dist = startPoint.distTo3D(el.last);
                if (dist < mindist) {
                    found = {el:el, first:el.last, last:el.first};
                    mindist = dist;
                }
            });
            if (found) {
                found.el.delete = true;
                // startPoint = found.last;
                startPoint = emitter(found.el, found.first, ++count);
            } else {
                break;
            }
        }

        return startPoint;
    }

    /**
     * like tip2tipEmit but accepts an array of polygons and the next closest
     * point can be anywhere in the adjacent polygon. should be re-written
     * to be more like outputOrderClosest() and have the option to account for
     * depth in determining distance
     */
    function poly2polyEmit(array, startPoint, emitter, options) {
        let opt = options || {};
        let marker = opt.mark || 'delete';
        let mindist, dist, found, count = 0;
        for (;;) {
            found = null;
            mindist = Infinity;
            array.forEach(function(poly) {
                if (poly[marker]) {
                    return;
                }
                if (poly.isOpen()) {
                    const d2f = startPoint.distTo2D(poly.first());
                    const d2l = startPoint.distTo2D(poly.last());
                    if (d2f > mindist && d2l > mindist) {
                        return;
                    }
                    if (d2l < mindist && d2l < d2f) {
                        poly.reverse();
                        found = {poly:poly, index:0, point:poly.first()};
                    } else if (d2f < mindist) {
                        found = {poly:poly, index:0, point:poly.first()};
                    }
                    return;
                }
                let area = poly.area();
                poly.forEachPoint(function(point, index) {
                    dist = opt.weight ?
                        startPoint.distTo3D(point) * area * area :
                        startPoint.distTo2D(point);
                    if (dist < mindist) {
                        found = {poly:poly, index:index, point:point};
                        mindist = dist;
                    }
                });
            });
            if (!found || opt.term) {
                break;
            }
            found.poly[marker] = true;
            startPoint = emitter(found.poly, found.index, ++count, startPoint) || found.point;
        }

        // undo delete marks
        array.forEach(function(poly) { poly[marker] = false });

        return startPoint;
    }

    /**
     * flatten deeply nested polygons preserving inner arrays
     *
     * @param {Polygon | Polygon[]} poly or array to flatten
     * @param {Polygon[]} to
     * @returns {Polygon[]}
     */
    function flattenPolygons(poly, to) {
        if (!poly) return;
        if (!to) to = [];
        if (Array.isArray(poly)) {
            poly.forEach(function(p) {
                flattenPolygons(p, to);
            })
        } else {
            to.push(poly);
            flattenPolygons(poly.inner, to);
        }
        return to;
    }

    function polygonFitsIn(inside, outside, tolerance) {
        return inside.isInside(outside, tolerance);
    }

    function polygonWithinOffset(poly1, poly2, offset) {
        return polygonMinOffset(poly1, poly2, offset) <= offset;
    }

    function polygonMinOffset(poly1, poly2, offset) {
        let mindist = Infinity;
        poly1.forEachPoint(function(p) {
            const nextdist = p.distToPolySegments(poly2, offset);
            mindist = Math.min(mindist, nextdist);
            // returning true terminates forEachPoint()
            if (mindist <= offset) return true;
        });
        return mindist;
    }

    /**
     * calculate mm of filament required for a given extrusion length and layer height.
     *
     * @param noz nozzle diameter
     * @param fil filament diameter
     * @param slice height in mm
     * @returns mm of filament extruded per mm of length on the layer
     */
    function extrudePerMM(noz, fil, slice) {
        return ((PI * SQR(noz/2)) / (PI * SQR(fil/2))) * (slice / noz);
    }

    function constOp(tok, consts, opch, op) {
        let pos, v1, v2;
        if ((pos = tok.indexOf(opch)) > 0) {
            v1 = consts[tok.substring(0,pos)] || 0;
            v2 = parseInt(tok.substring(pos+1)) || 0;
            return op(v1,v2);
        } else {
            return null;
        }
    }

    function constReplace(str, consts, start) {
        let cs = str.indexOf("{", start || 0),
            ce = str.indexOf("}", cs),
            tok, nutok, nustr;
        if (cs >=0 && ce > cs) {
            tok = str.substring(cs+1,ce);
            nutok =
                constOp(tok, consts, "-", function(v1,v2) { return v1-v2 }) ||
                constOp(tok, consts, "+", function(v1,v2) { return v1+v2 }) ||
                constOp(tok, consts, "/", function(v1,v2) { return v1/v2 }) ||
                constOp(tok, consts, "*", function(v1,v2) { return v1*v2 }) ||
                consts[tok] || 0;
            nustr = str.replace("{"+tok+"}",nutok);
            return constReplace(nustr, consts, ce+1+(nustr.length-str.length));
        } else {
            return str;
        }
    }

})();
