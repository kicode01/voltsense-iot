// ============================================================================
// VoltSense Smart Power Monitor - Parametric 3D Enclosure
// Calibrated with verified engineering dimensions:
//   - Outer Dimensions: 175.0 mm (W) x 130.0 mm (D) x 63.5 mm (H assembled)
//   - Base Chassis Height: 60.0 mm (+ 3.5 mm bottom foot pads)
//   - Top Lid Plate: 3.5 mm (+ 3.5 mm alignment skirt interlocking into base)
//   - Wall & Floor Thickness: 3.0 mm (Flame-retardant structural ABS/PETG)
//   - Corner Radius: 4.0 mm
//   - Corner Pillars: 4x 10x10 mm solid bosses with M3 screw holes (dia 2.8 mm, depth 25 mm)
//   - Component Mounting Standoffs (calibrated to real-world photo measurements):
//       * ESP32 DevKit V1: 4x M2 standoffs (48.0 x 23.0 mm pitch, dia 6.0 mm, hole 2.2 mm)
//       * 4-Channel Relay (75x55 mm): 4x M3 standoffs (69.0 x 46.0 mm pitch, dia 7.0 mm, hole 2.8 mm)
//       * ZMPT101B Voltage Sensor: 4x M2 standoffs (15.0 x 44.0 mm pitch, dia 5.5 mm, hole 2.2 mm)
//       * 3x ACS712 Current Sensors: 6x M2 standoffs (10.0 mm pitch across width, dia 4.5 mm, hole 2.0 mm) + terminal support pads
//       * Hi-Link HLK-5M05: Dedicated retention cradle with 4 corner clips + snap ridges (38.7 x 23.7 mm)
//       * PIR Sensor: 2x M2 front wall bosses (28.0 mm pitch) + 23.5 mm dome opening
//       * mmWave Radar: Internal retention guide rails + 22.5 x 16.5 mm window
//   - Safety Partition Barrier: 2.5 mm wall at Y = 49.5 mm, H = 48 mm with dual wiring portals (X=40, X=108)
//   - Rear Panel Cutouts:
//       * KCD1 Rocker Switch: 19.5 x 13.0 mm snap-in cutout at X = 32.0, Z = 45.0 (Upper Proportional Placement)
//       * IEC 60320 C14 Single-Fused Inlet: 28.0 x 32.0 mm cutout + 2x M3 holes (36 mm pitch) at X = 75.0, Z = 28.0
//       * 3x Output Cord Grommets: 12.5 mm round holes at X = 125, 142, 159 mm, Z = 24.0
//   - Side Ventilation: 9x 2.5 mm slots on left and right walls (60 mm span)
// ============================================================================

/* [Part to Render] */
lid_logo_engraving = false; // [true: Engrave VoltSense brand logo on top lid, false: Clean smooth lid matching v5 STL]
part = "base"; // [base: Base Chassis, lid: Top Cover Lid, hlk5m05: HLK-5M05 Module, components: All Internal Components, interior: Base + Components, assembly: Full Assembled View, exploded: Exploded View, bosses: Loose Glue-In Bosses]

/* [Standoff Tolerance]
   Use this when the PCB hole positions are not yet proven.
     integrated - as drawn: Ø7 boss, 2.8 pilot, 0.6 chamfer
     tolerant   - Ø9.5 boss, 60 deg lead-in cone, shorter by 0.3 mm so the
                  board never rocks; re-drill up to 3 mm off-centre
     slotted    - Ø9.5 boss with an obround pilot, +/-1.9 mm of travel
     loose      - no bosses in the chassis; print part="bosses" and glue
                  them in place with the PCB screwed on as the jig
*/
boss_mode = "tolerant"; // [integrated, tolerant, slotted, loose]

/* [Global Dimensions] */
box_length   = 170.0; // Outer length (X axis - left to right, matches v6)
box_width    = 208.0; // Outer width/depth (Y axis - front to back, 208 mm as requested for 9x15cm Carrier PCB!)
box_height   =  60.0; // Base chassis height (Z axis)
wall_th      =   3.0; // Wall thickness (mm)
floor_th     =   3.0; // Floor thickness (mm)
lid_th       =   3.5; // Top lid plate thickness (mm)
corner_rad   =   4.0; // Outer corner radius (mm)

/* [Safety Partition Barrier] */
partition_y  = 104.0; // Y position of internal safety divider (LV front: 104mm, HV rear: 104mm)
partition_th =   2.5; // Divider wall thickness (mm)
partition_h  =  48.0; // Divider height from bottom floor (mm)

/* [Corner Fasteners] */
boss_size    =   8.0; // Corner pillar width (mm)
screw_hole_d =   2.8; // M3 heat-set insert or self-tap pilot hole (mm)
screw_depth  =  25.0; // Depth of screw hole
lid_screw_d  =   3.4; // Clearance hole for M3 screw in lid (mm)
lid_cb_d     =   6.2; // M3 screw counterbore diameter (mm)
lid_cb_depth =   2.0; // Counterbore depth (mm)
fit_clearance=  0.35; // Gap for lid interlocking skirt (mm)

/* [Panel Cutouts] */
led_hole_d    =  10.2; // 10 mm status LEDs with 0.2 mm clearance
led_x         = 148.0; // Aligned with user final front panel layout

/* [Side Ventilation Grilles] */
vent_slot_len =  90.0; // Horizontal length of vent slot along Y (mm, expanded for 208mm chassis)
vent_slot_h   =   2.5; // Thinner slot opening height (2.5 mm: sleek, finger-safe, debris resistant)
vent_rib_h    =   2.5; // Solid wall bridge between slots (mm)
vent_slots_num=     8; // 8 horizontal slots extending from Z = 12 mm bottom to Z = 47 mm top (topmost slot removed on both sides)
vent_y_start  = (box_width - vent_slot_len) / 2.0; // Centered at Y = 65.0 mm (Y: 30..100 mm)

/* [Rear Panel Cutouts] */
switch_x       = 32.0; // KCD1 Rocker Switch center X (19.5 x 13.0 mm cutout, equidistant between corner and C14 inlet)
switch_z       = 38.5; // KCD1 Rocker Switch center Z (top edge at Z=46.0, flush with top of C14 flange)
// Note: Standalone circular fuse holder is ELIMINATED - replaced by integrated fuse drawer in C14 inlet
c14_x          = 75.0; // IEC 320 C14 Single-Fused Inlet center X (28.0 x 32.0 mm cutout)
c14_z          = 28.0; // Z center height for fused C14 inlet (clears PCB with 12mm bottom wall girder)
c14_pitch      = 36.0; // Mounting screw hole pitch (36.0 mm standard)
grommet_hole_d = 12.5; // Rubber grommet cutout for SJT 1.25 mm² x 3C (#16/3, 8.5 mm OD)
grommet_z      = 24.0; // Z center height
grommet_x_pos  = [114.5, 131.0, 147.5]; // 17.0 mm pitch; aligned with 3x ACS712 sensors and rear panel

/* [HLK-5M05 Power Supply Dimensions & Cradle] */
hlk_l = 38.0; // Length (mm)
hlk_w = 23.0; // Width (mm)
hlk_h = 18.0; // Height (mm)
hlk_cradle_x = 120.0; // X position on floor (Front-Right HV Chamber, in front of ACS712)
hlk_cradle_y = 116.0; // Y position on floor (leaving 19mm to ACS712, 11mm to partition wall)
hlk_cradle_z = floor_th; // Z floor base (3.0 mm)

$fn = 32; // Smooth arc resolution for primary shapes

// Include high-precision extracted 2D vector geometry for brand logo and calibration labels
include <logo_triangles.scad>;
include <status_labels_triangles.scad>;

// ============================================================================
// Helper Primitives
// ============================================================================

module rounded_box(l, w, h, r) {
    hull() {
        translate([r, r, 0]) cylinder(r=r, h=h, $fn=32);
        translate([l-r, r, 0]) cylinder(r=r, h=h, $fn=32);
        translate([r, w-r, 0]) cylinder(r=r, h=h, $fn=32);
        translate([l-r, w-r, 0]) cylinder(r=r, h=h, $fn=32);
    }
}

module squircle_2d(w, h, r) {
    hull() {
        translate([-(w/2 - r), -(h/2 - r)]) circle(r=r, $fn=24);
        translate([ (w/2 - r), -(h/2 - r)]) circle(r=r, $fn=24);
        translate([-(w/2 - r),  (h/2 - r)]) circle(r=r, $fn=24);
        translate([ (w/2 - r),  (h/2 - r)]) circle(r=r, $fn=24);
    }
}

module voltsense_emblem_2d(size=13.5) {
    difference() {
        squircle_2d(size, size, size * 0.22);
        polygon(points=[
            [ 0.117 * size,  0.527 * size],
            [-0.352 * size, -0.059 * size],
            [-0.039 * size, -0.059 * size],
            [-0.117 * size, -0.527 * size],
            [ 0.352 * size,  0.059 * size],
            [ 0.039 * size,  0.059 * size]
        ]);
    }
}

// Cylindrical Standoff with Chamfered Base & Accurate Screw Pilot Hole
// Boss diameter for the selected tolerance mode.
function boss_d(base_d) =
    boss_mode == "integrated" ? base_d : base_d + 2.5;

module standoff(x, y, h, outer_d, hole_d, hole_depth=4.5) {
    if (boss_mode != "loose") {
        od = boss_d(outer_d);
        // 0.3 mm shorter than nominal in the tolerant modes: the screw pulls
        // the board down instead of the boss holding it off and rocking it.
        hh = boss_mode == "integrated" ? h : h - 0.3;

        translate([x, y, floor_th]) {
            difference() {
                union() {
                    // Main cylindrical standoff body
                    cylinder(d=od, h=hh, $fn=24);
                    // Gusset / fillet flare at the base for high mechanical strength
                    cylinder(d1=od + 1.8, d2=od, h=1.5, $fn=24);
                }

                if (boss_mode == "slotted") {
                    // Obround pilot: +/-1.9 mm of adjustment along X
                    hull() {
                        translate([-1.9, 0, hh - hole_depth])
                            cylinder(d=hole_d, h=hole_depth + 0.1, $fn=16);
                        translate([ 1.9, 0, hh - hole_depth])
                            cylinder(d=hole_d, h=hole_depth + 0.1, $fn=16);
                    }
                } else {
                    // Precision screw pilot hole
                    translate([0, 0, hh - hole_depth])
                        cylinder(d=hole_d, h=hole_depth + 0.1, $fn=16);
                }

                if (boss_mode == "integrated") {
                    // Countersink chamfer at mouth for easy screw alignment
                    translate([0, 0, hh - 0.5])
                        cylinder(d1=hole_d, d2=hole_d + 0.8, h=0.6, $fn=16);
                } else {
                    // 60 deg lead-in cone: a screw entering 1 mm off-centre
                    // still finds the hole instead of walking off the top
                    translate([0, 0, hh - 2.0])
                        cylinder(d1=hole_d, d2=hole_d + 2.6, h=2.0, $fn=20);
                }
            }
        }
    }
}

// ----------------------------------------------------------------------------
// Loose glue-in boss (printed separately, positioned by the PCB itself)
// ----------------------------------------------------------------------------
module loose_boss(h=5.0, outer_d=9.5, hole_d=2.8, hole_depth=4.5) {
    flange_d = outer_d + 4.0;   // wide base = more glue area + forgiving seat
    flange_h = 1.6;

    difference() {
        union() {
            // Glue flange with a shallow skirt so epoxy has somewhere to sit
            cylinder(d=flange_d, h=flange_h, $fn=32);
            // Column
            translate([0, 0, flange_h - 0.01])
                cylinder(d=outer_d, h=h - flange_h, $fn=24);
        }
        // Pilot hole
        translate([0, 0, h - hole_depth])
            cylinder(d=hole_d, h=hole_depth + 0.1, $fn=16);
        // Lead-in cone
        translate([0, 0, h - 2.0])
            cylinder(d1=hole_d, d2=hole_d + 2.6, h=2.0, $fn=20);
        // Centre dimple underneath: drop it on a marked dot and it self-seats
        translate([0, 0, -0.01])
            cylinder(d1=1.2, d2=3.0, h=1.0, $fn=16);
        // Anti-rotation / glue relief notches
        for (a = [0 : 90 : 270])
            rotate([0, 0, a])
                translate([flange_d / 2 - 1.2, -1.0, -0.01])
                    cube([2.4, 2.0, flange_h + 0.02]);
    }
}

module loose_boss_plate() {
    // 12 posts on a 16 mm grid — print once, use as many as you need
    for (i = [0 : 11]) {
        translate([(i % 4) * 17.0, floor(i / 4) * 17.0, 0])
            loose_boss();
    }
}

// ============================================================================
// 1. HLK-5M05 AC-DC Step-Down Power Supply Module (3D Component)
// ============================================================================

module hlk_5m05_module() {
    color([0.12, 0.12, 0.14]) {
        difference() {
            cube([hlk_l, hlk_w, hlk_h]);
            translate([-1, -1, hlk_h - 0.8])
                rotate([45, 0, 0]) cube([hlk_l + 2, 2, 2]);
        }
    }
    
    // Silver Through-Hole Pins
    color([0.85, 0.85, 0.88]) {
        translate([3.5, 4.0, -4.0]) cylinder(d=0.8, h=4.0, $fn=12);
        translate([3.5, 4.0 + 5.08, -4.0]) cylinder(d=0.8, h=4.0, $fn=12);
        translate([hlk_l - 3.5, 3.8, -4.0]) cylinder(d=0.8, h=4.0, $fn=12);
        translate([hlk_l - 3.5, 3.8 + 15.24, -4.0]) cylinder(d=0.8, h=4.0, $fn=12);
    }
    
    // Silkscreen Label
    color([0.95, 0.95, 0.98]) {
        translate([hlk_l/2, hlk_w/2, hlk_h]) {
            cube([22.0, 14.0, 0.1], center=true);
        }
    }
}

// ============================================================================
// 2. HLK-5M05 Floor Retention Cradle (Integrated into Chassis Floor)
// ============================================================================

module hlk_retention_cradle() {
    c_th = 2.0;    // Cradle wall thickness
    c_h  = 7.0;    // Cradle post height
    c_clr = 0.35;  // Clearance per side
    c_in_l = hlk_l + 2*c_clr; // 38.7 mm
    c_in_w = hlk_w + 2*c_clr; // 23.7 mm
    
    translate([hlk_cradle_x - c_clr, hlk_cradle_y - c_clr, hlk_cradle_z]) {
        // Floor riser pad (keeps pins from shorting on floor, 1.5 mm high)
        cube([c_in_l, c_in_w, 1.5]);
            
        // 4 Corner Retention Brackets with snap/retention ridges
        // Corner 1 (Front-Left)
        translate([-c_th, -c_th, 0]) {
            cube([7.0, c_th, c_h]);
            cube([c_th, 7.0, c_h]);
        }
        // Corner 2 (Front-Right)
        translate([c_in_l - 7.0 + c_th, -c_th, 0]) cube([7.0, c_th, c_h]);
        translate([c_in_l, -c_th, 0]) cube([c_th, 7.0, c_h]);
        
        // Corner 3 (Rear-Left)
        translate([-c_th, c_in_w, 0]) cube([7.0, c_th, c_h]);
        translate([-c_th, c_in_w - 7.0 + c_th, 0]) cube([c_th, 7.0, c_h]);
        
        // Corner 4 (Rear-Right)
        translate([c_in_l - 7.0 + c_th, c_in_w, 0]) cube([7.0, c_th, c_h]);
        translate([c_in_l, c_in_w - 7.0 + c_th, 0]) cube([c_th, 7.0, c_h]);

        // Retaining strap screw bosses (M2 holes at sides)
        translate([c_in_l / 2, -c_th - 2.5, 0]) {
            difference() {
                cylinder(d=5.0, h=c_h, $fn=16);
                translate([0, 0, 1.0]) cylinder(d=2.0, h=c_h, $fn=12);
            }
        }
        translate([c_in_l / 2, c_in_w + c_th + 2.5, 0]) {
            difference() {
                cylinder(d=5.0, h=c_h, $fn=16);
                translate([0, 0, 1.0]) cylinder(d=2.0, h=c_h, $fn=12);
            }
        }
    }
}

// ============================================================================
// 2b. Internal Safety Partition Wall with Dual Wiring Arch Portals
// ============================================================================

module safety_partition_wall() {
    difference() {
        // Solid Partition Barrier Wall
        translate([wall_th, partition_y - partition_th/2, floor_th])
            cube([box_length - 2*wall_th, partition_th, partition_h]);
            
        // Portal 1 (Left Bay, X=40): Relay 4-Ch Logic Ribbon Cable (IN1-IN4, VCC, GND)
        // Cut width: 18 mm, Arch top: 16 mm above floor
        translate([40.0 - 9.0, partition_y - partition_th, floor_th - 0.5]) {
            cube([18.0, partition_th * 2, 7.5]);
            translate([9.0, 0, 7.5])
                rotate([-90, 0, 0])
                    cylinder(d=18.0, h=partition_th * 2, $fn=32);
        }
        
        // Portal 2 (Center-Right Bay, X=88): Sensor Analog Signal Returns (ZMPT101B & 3x ACS712)
        // Cut width: 18 mm, Arch top: 16 mm above floor
        translate([88.0 - 9.0, partition_y - partition_th, floor_th - 0.5]) {
            cube([18.0, partition_th * 2, 7.5]);
            translate([9.0, 0, 7.5])
                rotate([-90, 0, 0])
                    cylinder(d=18.0, h=partition_th * 2, $fn=32);
        }
        
        // Portal 3 (Right Bay, X=138): 220V AC Mains Live & Neutral directly into HLK-5M05
        // Cut width: 16 mm, Arch top: 16 mm above floor (Isolated from analog signals!)
        translate([138.0 - 8.0, partition_y - partition_th, floor_th - 0.5]) {
            cube([16.0, partition_th * 2, 7.5]);
            translate([8.0, 0, 7.5])
                rotate([-90, 0, 0])
                    cylinder(d=16.0, h=partition_th * 2, $fn=32);
        }
    }
}

// ============================================================================
// 3. Fully Parametric Base Chassis Model (With All Standoffs & Precision Holes)
// ============================================================================

module corner_pillar_with_relief(pos, dir_x, dir_y) {
    translate([pos[0], pos[1], floor_th]) {
        difference() {
            // Main solid pillar body (8 x 8 mm)
            cube([boss_size, boss_size, box_height - floor_th]);
            
            // Uniform 45-degree inner corner chamfer for full height (smooth, continuous, zero steps)
            // Generates clean clearance for the PCB corners with zero jagged ledges
            translate([dir_x > 0 ? boss_size : 0, dir_y > 0 ? boss_size : 0, -0.1])
                rotate([0, 0, 45])
                    cube([4.2, 4.2, (box_height - floor_th) * 2], center=true);
        }
    }
}

module enclosure_base() {
    difference() {
        union() {
            // 1. Hollow Outer Chassis Box
            difference() {
                rounded_box(box_length, box_width, box_height, corner_rad);
                translate([wall_th, wall_th, floor_th])
                    rounded_box(
                        box_length - 2*wall_th, 
                        box_width - 2*wall_th, 
                        box_height, 
                        max(0.5, corner_rad - wall_th)
                    );
            }
            
            // 2. Corner Feet / Risers (Bottom pads with anti-slip rubber foot recesses)
            foot_h = 3.5;
            foot_s = 14.0;
            for (pos = [
                [0, 0],
                [box_length - foot_s, 0],
                [0, box_width - foot_s],
                [box_length - foot_s, box_width - foot_s]
            ]) {
                translate([pos[0], pos[1], -foot_h])
                    difference() {
                        rounded_box(foot_s, foot_s, foot_h + 0.1, 2.0);
                        // 12 mm rubber foot recessed pocket
                        translate([foot_s/2, foot_s/2, -0.1])
                            cylinder(d=12.0, h=2.0, $fn=24);
                    }
            }
            
            // 3. 4x Corner Screw Pillars with Base Relief & 45-deg Inner Chamfer
            corner_pillar_with_relief([wall_th, wall_th], 1, 1);
            corner_pillar_with_relief([box_length - wall_th - boss_size, wall_th], -1, 1);
            corner_pillar_with_relief([wall_th, box_width - wall_th - boss_size], 1, -1);
            corner_pillar_with_relief([box_length - wall_th - boss_size, box_width - wall_th - boss_size], -1, -1);
            
            // 4. Internal Safety Isolation Barrier Wall with Integrated Portals
            safety_partition_wall();
                
            // 5a. 4x M3 Standoffs for 10x7 cm Orange Phenolic Protoboard (100.0 x 70.0 mm, Front Logic Bay)
            // Mounting holes: pitch 95.0 mm (X) x 65.0 mm (Y), M3 screw pilot hole (2.8 mm)
            // Centered at X = 85.0 mm (X: 35.0..135.0), Y: 32.0..102.0 (snug against partition at Y=104)
            proto_x0 = 37.5;
            proto_y0 = 34.5;
            proto_dx = 95.0;
            proto_dy = 65.0;
            standoff(proto_x0,            proto_y0,            5.0, 6.5, 2.8);
            standoff(proto_x0 + proto_dx, proto_y0,            5.0, 6.5, 2.8);
            standoff(proto_x0,            proto_y0 + proto_dy, 5.0, 6.5, 2.8);
            standoff(proto_x0 + proto_dx, proto_y0 + proto_dy, 5.0, 6.5, 2.8);

            // 5b. 4x Universal Outer Corner Bosses (142.0 x 82.0 mm pitch, M3 pilot 2.8 mm)
            // Retained in chassis floor for modular mounting options
            pcb_cx0 = 14.0;
            pcb_cy0 = 11.0;
            pcb_cdx = 142.0;
            pcb_cdy = 82.0;
            standoff(pcb_cx0,           pcb_cy0,           5.0, 7.0, 2.8);
            standoff(pcb_cx0 + pcb_cdx, pcb_cy0,           5.0, 7.0, 2.8);
            standoff(pcb_cx0,           pcb_cy0 + pcb_cdy, 5.0, 7.0, 2.8);
            standoff(pcb_cx0 + pcb_cdx, pcb_cy0 + pcb_cdy, 5.0, 7.0, 2.8);
            
            // 6. 4-Channel Relay Module Standoffs (75 mm x 55 mm board, Rear HV Bay)
            // Pitch: 69.0 mm (X) x 46.0 mm (Y), M3 screw pilot hole (2.8 mm)
            relay_x0 = 13.0;
            relay_y0 = 115.0;
            relay_dx = 69.0;
            relay_dy = 46.0;
            standoff(relay_x0,            relay_y0,            5.0, 7.0, 2.8);
            standoff(relay_x0 + relay_dx, relay_y0,            5.0, 7.0, 2.8);
            standoff(relay_x0,            relay_y0 + relay_dy, 5.0, 7.0, 2.8);
            standoff(relay_x0 + relay_dx, relay_y0 + relay_dy, 5.0, 7.0, 2.8);

            // 7. ZMPT101B Voltage Sensor Standoffs (19.4 mm x 49.5 mm board, Rear HV Bay)
            // Pitch: 15.0 mm (X) x 44.0 mm (Y), M2 screw pilot hole (2.2 mm)
            zmpt_x0 = 90.0;
            zmpt_y0 = 115.0;
            zmpt_dx = 15.0;
            zmpt_dy = 44.0;
            standoff(zmpt_x0,           zmpt_y0,           5.0, 5.5, 2.2);
            standoff(zmpt_x0 + zmpt_dx, zmpt_y0,           5.0, 5.5, 2.2);
            standoff(zmpt_x0,           zmpt_y0 + zmpt_dy, 5.0, 5.5, 2.2);
            standoff(zmpt_x0 + zmpt_dx, zmpt_y0 + zmpt_dy, 5.0, 5.5, 2.2);

            // 8. 3x ACS712 Current Sensor Mounts (13 mm x 31.5 mm each, Rear HV Bay)
            // Pitch: 10.0 mm across width, aligned with rear grommets at Y = 168.0 mm
            for (acs_x = grommet_x_pos) {
                standoff(acs_x - 5.0, 168.0, 5.0, 4.5, 2.0);
                standoff(acs_x + 5.0, 168.0, 5.0, 4.5, 2.0);
                // Terminal block anti-flex support ledge
                translate([acs_x - 5.0, 174.0, floor_th])
                    cube([10.0, 6.0, 5.0]);
            }

            // 9. Hi-Link HLK-5M05 Floor Cradle ELIMINATED:
            // Module is now mounted directly onto the 9x15 cm Universal Carrier PCB!
            // hlk_retention_cradle();

            // 10. HC-SR501 PIR Internal Mounting Screw Bosses (Front Wall)
            // Internal blind holes for M2 screws, keeping exterior front wall 100% clean and seamless!
            translate([35.0 - 14.0, wall_th, 30.0])
                rotate([-90, 0, 0])
                    difference() {
                        cylinder(d=5.0, h=4.0, $fn=16);
                        translate([0, 0, 0.5]) cylinder(d=2.0, h=4.0, $fn=12);
                    }
            translate([35.0 + 14.0, wall_th, 30.0])
                rotate([-90, 0, 0])
                    difference() {
                        cylinder(d=5.0, h=4.0, $fn=16);
                        translate([0, 0, 0.5]) cylinder(d=2.0, h=4.0, $fn=12);
                    }
        }
        
        // --- SUBTRACTIONS (Corner Holes, Wiring Ducts, Precision Cutouts) ---
        
        // 1. 4x Corner Screw Pilot Holes for M3 Screws / Brass Inserts (2.8 mm dia, 25 mm deep)
        screw_inset = wall_th + boss_size/2;
        for (pos = [
            [screw_inset, screw_inset],
            [box_length - screw_inset, screw_inset],
            [screw_inset, box_width - screw_inset],
            [box_length - screw_inset, box_width - screw_inset]
        ]) {
            translate([pos[0], pos[1], box_height - screw_depth])
                cylinder(d=screw_hole_d, h=screw_depth + 1.0, $fn=16);
        }
        

        // ====================================================================
        // FRONT PANEL CUTOUTS & ENGRAVINGS (Y = 0)
        // ====================================================================
        
        // A. HC-SR501 PIR Dome Cutout (PIR PCB: 32 mm x 24 mm)
        pir_center_x = 35.0;
        pir_center_z = 30.0;
        // Circular Dome opening (23.5 mm dia)
        translate([pir_center_x, -1.0, pir_center_z])
            rotate([-90, 0, 0])
                cylinder(d=23.5, h=wall_th + 2.0, $fn=36);
        // Internal PCB seat recess (32.5 mm x 24.5 mm x 1.5 mm deep)
        translate([pir_center_x - 16.25, wall_th - 1.5, pir_center_z - 12.25])
            cube([32.5, 2.0, 24.5]);
                
        // B. mmWave Radar Center Window (mmWave: 22 mm x 16 mm)
        radar_center_x = 85.0;
        radar_center_z = 30.0;
        // Window opening tailored to 22 mm x 16 mm sensor
        translate([radar_center_x - 11.25, -1.0, radar_center_z - 8.25])
            cube([22.5, wall_th + 2.0, 16.5]);
            
        // Decorative Bezel Recess on Front Face
        translate([radar_center_x - 15.0, -0.1, radar_center_z - 12.0])
            cube([30.0, 1.2, 24.0]);
            
        // C. 3x Status LEDs (10.2 mm diameter, exactly centered with engraved labels STATUS:43, WIFI:30, LOAD:17)
        for (led_z = [43.0, 30.0, 17.0]) {
            translate([led_x, -1.0, led_z])
                rotate([-90, 0, 0])
                    cylinder(d=led_hole_d, h=wall_th + 2.0, $fn=24);
        }

        // D. FRONT PANEL ENGRAVED VOLTSENSE BRAND LOGO & LED LABELS
        // Precision engraved into front wall face matching voltsense_enclosure_base_final_v6.stl
        translate([0, 0.8, 0]) rotate([90, 0, 0]) linear_extrude(height = 1.0) {
            // 1. Official VoltSense Brand Logo & Wordmark (Squircle Badge + Waves + Bolt + Bold Wordmark)
            voltsense_enclosure_logo();
        }

        translate([0, 0.6, 0]) rotate([90, 0, 0]) linear_extrude(height = 0.8) {
            // 2. 3x Status LED Calibration Labels (Right-Aligned at X = 139.5, centered with LEDs at Z = 43, 30, 17)
            voltsense_led_labels_2d();
        }

        // ====================================================================
        // REAR PANEL CUTOUTS (Y = box_width = 110 mm)
        // ====================================================================
        
        // 1. Master KCD1 Rocker Switch (19.5 x 13.0 mm cutout at X = switch_x, Z = switch_z)
        translate([switch_x - 19.5/2, box_width - wall_th - 1.0, switch_z - 13.0/2])
            cube([19.5, wall_th + 2.0, 13.0]);

        // 2. IEC 320 C14 Single-Fused Power Inlet (28.0 x 32.0 mm cutout + 2x M3 mounting holes at 36.0 mm pitch)
        // Replaces separate plain C14 and eliminates standalone circular fuse holder!
        translate([c14_x - 28.0/2, box_width - wall_th - 1.0, c14_z - 32.0/2])
            cube([28.0, wall_th + 2.0, 32.0]);
        // 2x M3 Mounting screw holes (36.0 mm pitch -> +/- 18.0 mm from center)
        translate([c14_x - c14_pitch/2, box_width - wall_th - 1.0, c14_z])
            rotate([-90, 0, 0])
                cylinder(d=3.4, h=wall_th + 2.0, $fn=16);
        translate([c14_x + c14_pitch/2, box_width - wall_th - 1.0, c14_z])
            rotate([-90, 0, 0])
                cylinder(d=3.4, h=wall_th + 2.0, $fn=16);

        // 4. 3x Rear Cable Pass-Throughs for SJT 16/3 Rubber Grommets (12.5 mm dia)
        // Positioned at X = 118.0, 133.5, 149.0 mm
        for (hx = grommet_x_pos) {
            translate([hx, box_width - wall_th - 1.0, grommet_z])
                rotate([-90, 0, 0])
                    cylinder(d=grommet_hole_d, h=wall_th + 2.0, $fn=24);
        }

        // ====================================================================
        // SIDE VENTILATION SLOTS (Left X = 0, Right X = 170)
        // ====================================================================
        for (side_x = [-1.0, box_length - wall_th - 1.0]) {
            for (i = [0 : vent_slots_num - 1]) {
                v_z = 12.0 + i * (vent_slot_h + vent_rib_h);
                translate([side_x, vent_y_start, v_z])
                    cube([wall_th + 2.0, vent_slot_len, vent_slot_h]);
            }
        }
    }
}

// ============================================================================
// 4. Top Cover Lid Model (Directly Parametric with Countersunk Screw Holes)
// ============================================================================

module enclosure_lid() {
    skirt_depth = 3.5;
    skirt_th    = 2.0;
    
    difference() {
        union() {
            // 1. Top Cover Outer Plate
            rounded_box(box_length, box_width, lid_th, corner_rad);
            
            // 2. Interlocking Inner Alignment Skirt
            translate([
                wall_th + fit_clearance, 
                wall_th + fit_clearance, 
                -skirt_depth
            ]) {
                difference() {
                    rounded_box(
                        box_length - 2*(wall_th + fit_clearance), 
                        box_width - 2*(wall_th + fit_clearance), 
                        skirt_depth + 0.1, 
                        max(0.5, corner_rad - wall_th)
                    );
                    translate([skirt_th, skirt_th, -0.1])
                        rounded_box(
                            box_length - 2*(wall_th + fit_clearance + skirt_th), 
                            box_width - 2*(wall_th + fit_clearance + skirt_th), 
                            skirt_depth + 0.5, 
                            max(0.5, corner_rad - wall_th - skirt_th)
                        );
                }
            }
        }
        
        // --- 4x Corner Screw Boss Clearance Notches in Inner Skirt ---
        // Clears the 9x9mm solid corner screw boss pillars in the base enclosure
        // Leaves flat 12.5x12.5mm solid landing pads on the underside of the lid plate
        // that rest directly on top of the 4 corner pillars for rigid vertical support.
        corner_notch_size = wall_th + boss_size + 1.0; // 2.5 + 9.0 + 1.0 = 12.5 mm
        for (c_pos = [
            [-0.5, -0.5],
            [box_length - corner_notch_size, -0.5],
            [-0.5, box_width - corner_notch_size],
            [box_length - corner_notch_size, box_width - corner_notch_size]
        ]) {
            translate([c_pos[0], c_pos[1], -skirt_depth - 1.0])
                cube([corner_notch_size + 0.5, corner_notch_size + 0.5, skirt_depth + 1.05]);
        }

        // Optional VoltSense brand logo engraved on lid top surface
        if (lid_logo_engraving) {
            translate([box_length/2 - 42.0, box_width/2 - 13.5, lid_th - 0.6])
                linear_extrude(height = 1.0)
                    voltsense_enclosure_logo();
        }

        // --- 4x Countersunk Corner Screw Holes ---
        screw_inset = wall_th + boss_size/2;
        for (pos = [
            [screw_inset, screw_inset],
            [box_length - screw_inset, screw_inset],
            [screw_inset, box_width - screw_inset],
            [box_length - screw_inset, box_width - screw_inset]
        ]) {
            // Clearance through-hole
            translate([pos[0], pos[1], -skirt_depth - 1.0])
                cylinder(d=lid_screw_d, h=lid_th + skirt_depth + 2.0, $fn=16);
            // Counterbore for M3 screw head flush fit
            translate([pos[0], pos[1], lid_th - lid_cb_depth])
                cylinder(d=lid_cb_d, h=lid_cb_depth + 0.5, $fn=24);
        }

        // Top Heat-Exhaust Ventilation Slots (over High-Voltage Bay)
        for (i = [0 : 7]) {
            translate([25.0 + i * 15.0, box_width * 0.72 - 12.0, -skirt_depth - 1.0])
                cube([2.5, 24.0, lid_th + skirt_depth + 2.0]);
        }
    }
}

// ============================================================================
// 5. All Internal Components & Wiring Assembly (Accurate 3D Models)
// ============================================================================

module rear_panel_hardware() {
    // 1. IEC 320 C14 Single-Fused AC Inlet Socket (X=72, Y=110, Z=24)
    translate([c14_x, box_width - 1.0, c14_z]) {
        color([0.15, 0.15, 0.15]) rotate([90, 0, 0]) {
            // Main body passing through panel
            cube([27.5, 31.5, 22.0], center=true);
            // Outer flange with screw ears (44mm wide x 36mm high x 3.5mm thick)
            translate([0, 0, 11.0]) cube([44.0, 36.0, 3.5], center=true);
            // Lower integrated fuse drawer bezel
            translate([0, -8.0, 12.8]) cube([20.0, 11.0, 1.2], center=true);
        }
        // Terminal solder lugs behind panel
        color([0.85, 0.85, 0.88]) {
            translate([-5.0, -20.0, -5.0]) cube([1.2, 8.0, 4.8]);
            translate([ 5.0, -20.0, -5.0]) cube([1.2, 8.0, 4.8]);
            translate([ 0.0, -20.0,  6.0]) cube([1.2, 8.0, 4.8]);
        }
    }
    
    // 2. Master KCD1 Rocker Switch (X=switch_x, Y=box_width, Z=switch_z, Matte Black Nylon Sideways Toggle)
    translate([switch_x, box_width - 1.0, switch_z]) {
        color([0.15, 0.15, 0.15]) rotate([90, 0, 0]) cube([21.0, 15.0, 16.0], center=true);
        color([0.22, 0.22, 0.25]) translate([0, 2.0, 0]) rotate([90, 0, 0]) cube([16.0, 10.5, 3.0], center=true);
    }
    
    // Note: Standalone fuse holder is ELIMINATED!
    
    // 3. 3x Output cord glands: rubber bushing through the wall, flange proud of
    //    the panel, strain-relief collar, then a 26 mm SJT 16/3 cord stub.
    for (gx = grommet_x_pos) {
        translate([gx, box_width, grommet_z]) {
            // bushing through the 12.5 mm hole
            color([0.09, 0.09, 0.11])
                translate([0, -4.0, 0]) rotate([-90, 0, 0]) cylinder(d=12.0, h=9.0, center=true, $fn=24);
            // flange proud of the panel face
            color([0.07, 0.07, 0.09])
                translate([0, 0.9, 0]) rotate([-90, 0, 0]) cylinder(d=14.4, h=1.8, center=true, $fn=24);
            // strain-relief collar
            color([0.07, 0.07, 0.09])
                translate([0, 3.6, 0]) rotate([-90, 0, 0]) cylinder(d1=10.8, d2=9.2, h=4.0, center=true, $fn=24);
            // cord stub
            color([0.05, 0.05, 0.06])
                translate([0, 15.6, 0]) rotate([-90, 0, 0]) cylinder(d=8.5, h=26.0, center=true, $fn=24);
        }
    }
}

module internal_components(include_rear_plugs=true) {
    // ------------------------------------------------------------------
    // Calibrated 1:1 to physical build photos:
    //   protoboard  X 35..135,   Y 32..102,       Z 8.0  (95 x 65 M3 pitch)
    //   ESP32       X 36.0..87.5, Y 53.0..81.0,   Z 18.1 in dual sockets
    //   relay       X 12..87,    Y 110.5..165.5,  Z 8.0  (69 x 46 M3 pitch)
    //   ZMPT        X 89.75..109.25, Y 112.25..161.75, Z 8.0 (15 x 44 M2 pitch)
    //   ACS712      X ax +/- 6.5, Y 161.75..193.25, Z 8.0 (10 mm pitch at Y=168)
    // ------------------------------------------------------------------

    // A. 10x7 cm Orange Phenolic Perfboard / Protoboard (100.0 x 70.0 x 1.6 mm)
    // Warm amber / copper-brown phenolic resin substrate
    color([0.72, 0.35, 0.10]) translate([35.0, 32.0, 8.0]) cube([100.0, 70.0, 1.6]);

    // 4x M3 corner screws on 95 x 65 mm pitch
    color([0.8, 0.8, 0.85]) {
        translate([37.5, 34.5, 9.6]) cylinder(d=5.5, h=1.2, $fn=16);
        translate([132.5, 34.5, 9.6]) cylinder(d=5.5, h=1.2, $fn=16);
        translate([37.5, 99.5, 9.6]) cylinder(d=5.5, h=1.2, $fn=16);
        translate([132.5, 99.5, 9.6]) cylinder(d=5.5, h=1.2, $fn=16);
    }

    // B. ESP32 DevKit V1 (51.5 x 28.0 x 1.6 mm) seated horizontally in dual 15-pin sockets
    // Center at (61.75, 67.0) -> X: 36.0..87.5, Y: 53.0..81.0
    translate([61.75 - 51.5/2, 67.0 - 28.0/2, 18.1]) {
        color([0.1, 0.12, 0.15]) cube([51.5, 28.0, 1.6]);
        // Dual 15-pin female header strips along X at local Y=2.5 and Y=25.0
        color([0.15, 0.15, 0.15]) {
            translate([2.5, 0.5, -8.5]) cube([46.5, 2.5, 8.5]);
            translate([2.5, 25.0, -8.5]) cube([46.5, 2.5, 8.5]);
        }
        // ESP-WROOM-32 RF shield can on the LEFT (-X, toward outer wall)
        color([0.75, 0.76, 0.78]) translate([5.0, 5.0, 1.6]) cube([18.0, 18.0, 3.0]);
        // Micro-USB connector on the RIGHT (+X, facing inward toward board passives)
        color([0.82, 0.83, 0.85]) translate([51.5 - 2.0, 9.5, 1.6]) cube([7.5, 9.0, 3.2]);
        // 4x M2 corner screws
        color([0.8, 0.8, 0.85]) {
            translate([1.75, 2.5, 1.6]) cylinder(d=3.8, h=1.2, $fn=16);
            translate([49.75, 2.5, 1.6]) cylinder(d=3.8, h=1.2, $fn=16);
            translate([1.75, 25.5, 1.6]) cylinder(d=3.8, h=1.2, $fn=16);
            translate([49.75, 25.5, 1.6]) cylinder(d=3.8, h=1.2, $fn=16);
        }
    }

    // C. Discrete Passives & Headers on Protoboard (Right Half: X 92..132, Y 45..98)
    // 6x Voltage divider axial resistors (1k/2k pairs)
    for (rx = [98.0, 106.0, 114.0]) {
        color([0.82, 0.75, 0.62]) {
            translate([rx - 2.5, 80.0, 10.8]) rotate([0, 90, 0]) cylinder(d=2.0, h=5.0, $fn=12);
            translate([rx - 2.5, 72.0, 10.8]) rotate([0, 90, 0]) cylinder(d=2.0, h=5.0, $fn=12);
        }
    }
    // 2x 330R LED current-limiting resistors
    for (rx = [100.0, 108.0]) {
        color([0.82, 0.75, 0.62])
            translate([rx - 2.5, 60.0, 10.8]) rotate([0, 90, 0]) cylinder(d=2.0, h=5.0, $fn=12);
    }
    // 2x Radial electrolytic capacitors
    color([0.15, 0.15, 0.18]) {
        translate([124.0, 75.0, 9.6]) cylinder(d=5.0, h=8.5, $fn=20);
        translate([124.0, 55.0, 9.6]) cylinder(d=5.0, h=8.5, $fn=20);
    }
    // Active Alarm Buzzer
    color([0.1, 0.1, 0.12])
        translate([96.0, 48.0, 9.6]) cylinder(d=11.0, h=7.5, $fn=32);

    // DuPont Pin Headers on Protoboard:
    // J_RELAY (6-pin) facing Portal 1 (X=40)
    color([0.12, 0.12, 0.14]) translate([40.0, 96.0, 9.6]) cube([15.24, 2.54, 2.5]);
    // J_SENSORS (6-pin) facing Portal 2 (X=88)
    color([0.12, 0.12, 0.14]) translate([90.0, 96.0, 9.6]) cube([15.24, 2.54, 2.5]);
    // Front panel peripheral headers
    color([0.12, 0.12, 0.14]) {
        translate([45.0, 36.0, 9.6]) cube([7.62, 2.54, 2.5]);
        translate([85.0, 36.0, 9.6]) cube([10.16, 2.54, 2.5]);
        translate([122.0, 36.0, 9.6]) cube([10.16, 2.54, 2.5]);
    }

    // E. 4-Channel 5V Relay Board (75 x 55) on the 69 x 46 M3 pitch
    translate([12.0, 110.5, 8.0]) {
        color([0.08, 0.18, 0.35]) cube([75.0, 55.0, 1.6]);
        // 4x Songle relays across the board width
        for (r_idx = [0 : 3]) {
            translate([8.5 + r_idx * 17.5, 22.5, 1.6]) {
                color([0.1, 0.45, 0.85]) cube([15.5, 19.0, 15.0]);
            }
        }
        // 12-pole green screw terminal along rear edge
        color([0.15, 0.55, 0.25]) translate([7.0, 46.5, 1.6]) cube([60.96, 8.5, 10.0]);
        // 6-pin control header facing Portal 1 (X=40)
        color([0.12, 0.12, 0.14]) translate([20.4, 2.0, 1.6]) cube([15.24, 2.54, 2.5]);
        // 4x M3 screws
        color([0.8, 0.8, 0.85]) {
            translate([3.0, 4.5, 1.6]) cylinder(d=5.5, h=1.5, $fn=16);
            translate([72.0, 4.5, 1.6]) cylinder(d=5.5, h=1.5, $fn=16);
            translate([3.0, 50.5, 1.6]) cylinder(d=5.5, h=1.5, $fn=16);
            translate([72.0, 50.5, 1.6]) cylinder(d=5.5, h=1.5, $fn=16);
        }
    }

    // F. ZMPT101B Module (19.5 x 49.5) centered at (99.5, 137.0) on 15 x 44 M2 pitch
    translate([89.75, 112.25, 8.0]) {
        color([0.08, 0.18, 0.35]) cube([19.5, 49.5, 1.6]);
        color([0.15, 0.4, 0.75]) translate([5.0, 34.5, 1.6]) cube([9.5, 4.5, 9.5]);
        color([0.15, 0.55, 0.25]) translate([4.7, 41.0, 1.6]) cube([10.16, 8.5, 10.0]);
        color([0.12, 0.12, 0.14]) translate([4.7, 1.2, 1.6]) cube([10.16, 2.54, 2.5]);
        color([0.8, 0.8, 0.85]) {
            translate([2.25, 2.75, 1.6]) cylinder(d=3.8, h=1.2, $fn=16);
            translate([17.25, 2.75, 1.6]) cylinder(d=3.8, h=1.2, $fn=16);
            translate([2.25, 46.75, 1.6]) cylinder(d=3.8, h=1.2, $fn=16);
            translate([17.25, 46.75, 1.6]) cylinder(d=3.8, h=1.2, $fn=16);
        }
    }

    // G. 3x ACS712-05B Current Sensors (13 x 31.5) aligned with rear grommets (114.5, 131.0, 147.5)
    for (ax = grommet_x_pos) {
        translate([ax - 6.5, 161.75, 8.0]) {
            color([0.08, 0.18, 0.35]) cube([13.0, 31.5, 1.6]);
            color([0.12, 0.12, 0.14]) translate([4.0, 11.5, 1.6]) cube([5.0, 4.0, 1.5]);
            color([0.15, 0.55, 0.25]) translate([1.42, 23.0, 1.6]) cube([10.16, 8.5, 10.0]);
            color([0.12, 0.12, 0.14]) translate([2.69, 1.0, 1.6]) cube([7.62, 2.54, 2.5]);
            color([0.8, 0.8, 0.85]) {
                translate([1.5, 6.25, 1.6]) cylinder(d=3.8, h=1.2, $fn=16);
                translate([11.5, 6.25, 1.6]) cylinder(d=3.8, h=1.2, $fn=16);
            }
        }
    }

    // H. Front-wall mounted sensors (PIR + mmWave + 3x LEDs)
    color([0.95, 0.95, 0.98]) translate([35.0, wall_th + 1.0, 30.0])
        rotate([-90, 0, 0]) cylinder(d=23.5, h=14.0, $fn=32);
    color([0.08, 0.18, 0.35]) translate([85.0 - 11.0, wall_th, 30.0 - 8.0])
        cube([22.0, 1.6, 16.0]);
    for (led_z = [43.0, 30.0, 17.0]) {
        color([0.2, 0.8, 0.4]) translate([148.0, wall_th, led_z])
            rotate([-90, 0, 0]) cylinder(d=10.0, h=6.0, $fn=24);
    }

    // K. Rear panel hardware
    if (include_rear_plugs) {
        rear_panel_hardware();
    }

    // L. Standard-compliant wiring runs (AC Mains strictly within HV bay)
    // 1. Switched Live: Rocker -> Relay COM bus + Tap to ZMPT AC(L)
    color([0.9, 0.15, 0.15]) {
        translate([24.0, 182.0, 19.0]) rotate([0, 90, 0]) cylinder(d=2.2, h=46.0, $fn=12);
        translate([24.0, 170.0, 18.0]) rotate([0, 90, 0]) cylinder(d=2.2, h=50.0, $fn=12);
    }
    // 2. 220V Neutral: C14 Neutral spade -> ZMPT AC(N) & daisy-chained to cord neutrals
    color([0.2, 0.45, 0.9]) {
        translate([79.0, 186.0, 18.0]) rotate([0, 90, 0]) cylinder(d=2.2, h=20.0, $fn=12);
    }
    // 3. Earth: C14 Earth spade -> cord earths
    color([0.2, 0.75, 0.3]) {
        translate([75.0, 181.0, 30.0]) rotate([0, 90, 0]) cylinder(d=2.0, h=10.0, $fn=12);
        translate([86.0, 200.5, 6.0]) rotate([0, 90, 0]) cylinder(d=2.0, h=69.0, $fn=12);
    }
    // 4. Relay 4-Ch Ribbon through Portal 1 (X=40)
    color([0.5, 0.2, 0.7]) {
        translate([40.0, 95.0, 10.0]) rotate([90, 0, 0]) cylinder(d=2.0, h=18.0, $fn=12);
    }
    // 5. Analog Return Bundle through Portal 2 (X=88)
    color([0.9, 0.8, 0.2]) {
        translate([88.0, 95.0, 10.0]) rotate([90, 0, 0]) cylinder(d=2.0, h=18.0, $fn=12);
    }
}

if (part == "base") {
    enclosure_base();
} else if (part == "lid") {
    enclosure_lid();
} else if (part == "hlk5m05") {
    hlk_5m05_module();
} else if (part == "components") {
    internal_components(include_rear_plugs=false);
} else if (part == "rear_hardware") {
    rear_panel_hardware();
} else if (part == "interior") {
    color("whitesmoke") enclosure_base();
    internal_components(include_rear_plugs=true);
} else if (part == "assembly") {
    color("whitesmoke") enclosure_base();
    internal_components(include_rear_plugs=true);
    color("ghostwhite", 0.88) translate([0, 0, box_height]) enclosure_lid();
} else if (part == "bosses") {
    loose_boss_plate();
} else if (part == "exploded") {
    color("whitesmoke") enclosure_base();
    internal_components(include_rear_plugs=true);
    color("ghostwhite", 0.92) translate([0, 0, box_height + 40.0]) enclosure_lid();
}
