// ============================================================================
// VoltSense Smart Power Monitor - Parametric 3D Enclosure
// Calibrated to exact component measurements:
//   - ZMPT101B Voltage Sensor: 49.5 mm x 19.4 mm
//   - ACS712 Current Sensors (x3): 31.0 mm x 13.0 mm
//   - ESP32 NodeMCU: 55.0 mm x 27.0 mm
//   - PIR Motion Sensor: 32.0 mm x 24.0 mm (dome dia 23.0 mm)
//   - 4-Channel Relay Module: 75.0 mm x 55.0 mm
//   - 3P AC Power Male Plug C14: 55.0 mm x 22.5 mm x 20.0 mm
//   - mmWave Radar Sensor: 22.0 mm x 16.0 mm
//   - Master Power Switch: 20.0 mm x 14.0 mm (KCD1 rocker)
//   - Panel Fuse Holder: 12.2 mm (for 5x20mm T5AH250V fuse)
//   - 3x Output Cable Glands: 12.5 mm (PG7 for Outlets 1, 2, 3)
//   - 3x Status LEDs: 10.0 mm (10.2 mm cutout clearance)
//   - Dual Side Ventilation Grilles: 9x 2.5 mm thin convection slots (60 mm span)
// ============================================================================

/* [Part to Render] */
part = "base"; // [base: Base Chassis, lid: Top Cover Lid, assembly: Full Assembled View, exploded: Exploded View]

/* [Global Dimensions] */
box_length   = 170.0; // Outer length (X axis - left to right)
box_width    = 110.0; // Outer width/depth (Y axis - front to back)
box_height   =  60.0; // Base chassis height (Z axis)
wall_th      =   3.0; // Wall thickness (mm)
floor_th     =   3.0; // Floor thickness (mm)
lid_th       =   3.5; // Top lid plate thickness (mm)
corner_rad   =   4.0; // Outer corner radius (mm)

/* [Safety Partition Barrier] */
partition_y  =  52.0; // Y position of internal safety divider (LV front / HV rear)
partition_th =   2.5; // Divider wall thickness (mm)
partition_h  =  48.0; // Divider height from bottom floor (mm)

/* [Corner Fasteners] */
boss_size    =  10.0; // Corner pillar width (mm)
screw_hole_d =   2.8; // M3 heat-set insert or self-tap pilot hole (mm)
screw_depth  =  25.0; // Depth of screw hole
lid_screw_d  =   3.4; // Clearance hole for M3 screw in lid (mm)
lid_cb_d     =   6.2; // M3 screw counterbore diameter (mm)
lid_cb_depth =   2.0; // Counterbore depth (mm)

/* [Panel Cutouts] */
led_hole_d    =  10.2; // Diameter for 10 mm status LEDs (or 10 mm panel-mount bezels with 0.2 mm clearance)

/* [Side Ventilation Grilles] */
vent_slot_len =  60.0; // Horizontal length of vent slot along Y (mm)
vent_slot_h   =   2.5; // Thinner slot opening height (2.5 mm: sleek, finger-safe, debris resistant)
vent_rib_h    =   2.5; // Solid wall bridge between slots (mm)
vent_slots_num=     9; // Number of horizontal slots (spans from Z = 12 mm bottom to Z = 52 mm top)

/* [Tolerances] */
fit_clearance =  0.35; // Gap for lid interlocking skirt (mm)
$fn = 60;              // Arc resolution for smooth circles

// ============================================================================
// Helper Primitives
// ============================================================================

module rounded_box(l, w, h, r) {
    hull() {
        translate([r, r, 0]) cylinder(r=r, h=h);
        translate([l-r, r, 0]) cylinder(r=r, h=h);
        translate([r, w-r, 0]) cylinder(r=r, h=h);
        translate([l-r, w-r, 0]) cylinder(r=r, h=h);
    }
}

module standoff(x, y, h, outer_d, hole_d) {
    translate([x, y, floor_th]) {
        difference() {
            cylinder(d=outer_d, h=h);
            translate([0, 0, -0.1]) cylinder(d=hole_d, h=h + 0.2);
        }
    }
}

// ============================================================================
// Base Chassis Model
// ============================================================================

module enclosure_base() {
    difference() {
        union() {
            // 1. Hollow outer box
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
            
            // 2. Corner feet / risers (bottom pads matching render)
            foot_h = 3.5;
            foot_s = 14.0;
            for (pos = [
                [0, 0],
                [box_length - foot_s, 0],
                [0, box_width - foot_s],
                [box_length - foot_s, box_width - foot_s]
            ]) {
                translate([pos[0], pos[1], -foot_h])
                    rounded_box(foot_s, foot_s, foot_h + 0.1, 2.0);
            }
            
            // 3. Corner screw pillars (inside box)
            for (pos = [
                [wall_th, wall_th],
                [box_length - wall_th - boss_size, wall_th],
                [wall_th, box_width - wall_th - boss_size],
                [box_length - wall_th - boss_size, box_width - wall_th - boss_size]
            ]) {
                translate([pos[0], pos[1], floor_th])
                    cube([boss_size, boss_size, box_height - floor_th]);
            }
            
            // 4. Internal Safety Isolation Barrier Wall
            translate([wall_th, partition_y - partition_th/2, floor_th])
                cube([box_length - 2*wall_th, partition_th, partition_h]);
                
            // 5. ESP32 NodeMCU Standoffs (55 mm x 27 mm board, Front Zone)
            esp_x0 = 55.0;
            esp_y0 = 15.0;
            esp_dx = 50.0;
            esp_dy = 22.0;
            standoff(esp_x0,          esp_y0,          5.0, 6.0, 2.2);
            standoff(esp_x0 + esp_dx, esp_y0,          5.0, 6.0, 2.2);
            standoff(esp_x0,          esp_y0 + esp_dy, 5.0, 6.0, 2.2);
            standoff(esp_x0 + esp_dx, esp_y0 + esp_dy, 5.0, 6.0, 2.2);
            
            // 6. 4-Channel Relay Module Standoffs (75 mm x 55 mm board, Rear Zone)
            relay_x0 = 18.0;
            relay_y0 = 58.0;
            relay_dx = 69.0;
            relay_dy = 46.0;
            standoff(relay_x0,            relay_y0,            5.0, 6.5, 2.8);
            standoff(relay_x0 + relay_dx, relay_y0,            5.0, 6.5, 2.8);
            standoff(relay_x0,            relay_y0 + relay_dy, 5.0, 6.5, 2.8);
            standoff(relay_x0 + relay_dx, relay_y0 + relay_dy, 5.0, 6.5, 2.8);

            // 7. ZMPT101B Voltage Sensor Standoffs (49.5 mm x 19.4 mm board)
            zmpt_x0 = 98.0;
            zmpt_y0 = 60.0;
            standoff(zmpt_x0,        zmpt_y0,        5.0, 5.5, 2.2);
            standoff(zmpt_x0 + 44.0, zmpt_y0,        5.0, 5.5, 2.2);
            standoff(zmpt_x0,        zmpt_y0 + 15.0, 5.0, 5.5, 2.2);
            standoff(zmpt_x0 + 44.0, zmpt_y0 + 15.0, 5.0, 5.5, 2.2);

            // 8. 3x ACS712 Current Sensor Mounts (31 mm x 13 mm each)
            for (idx = [0, 1, 2]) {
                acs_x = 100.0 + idx * 18.0;
                standoff(acs_x, 88.0, 5.0, 5.0, 2.2);
                standoff(acs_x, 102.0, 5.0, 5.0, 2.2);
            }
        }
        
        // --- SUBTRACTIONS (Corner holes, Barrier duct, Panel Cutouts) ---
        
        // 1. Corner Screw Pilot Holes (for M3 screws or brass heat-set inserts)
        screw_inset = wall_th + boss_size/2;
        for (pos = [
            [screw_inset, screw_inset],
            [box_length - screw_inset, screw_inset],
            [screw_inset, box_width - screw_inset],
            [box_length - screw_inset, box_width - screw_inset]
        ]) {
            translate([pos[0], pos[1], box_height - screw_depth])
                cylinder(d=screw_hole_d, h=screw_depth + 1.0);
        }
        
        // 2. Safety Barrier Wire Pass-Through Duct
        translate([85.0 - 10.0, partition_y - partition_th - 1.0, floor_th])
            cube([20.0, partition_th + 2.0, 12.0]);
            
        // ====================================================================
        // FRONT PANEL CUTOUTS (Y = 0)
        // ====================================================================
        
        // A. HC-SR501 PIR Dome Cutout (PIR PCB: 32 mm x 24 mm)
        pir_center_x = 35.0;
        pir_center_z = 30.0;
        // Circular Dome opening (23.5 mm dia)
        translate([pir_center_x, -1.0, pir_center_z])
            rotate([-90, 0, 0])
                cylinder(d=23.5, h=wall_th + 2.0);
        // Internal PCB seat recess (32.5 mm x 24.5 mm x 1.5 mm deep)
        translate([pir_center_x - 16.25, wall_th - 1.5, pir_center_z - 12.25])
            cube([32.5, 2.0, 24.5]);
                
        // B. mmWave Radar Center Window (mmWave: 22 mm x 16 mm)
        radar_center_x = 85.0;
        radar_center_z = 30.0;
        // Window opening tailored to 22 mm x 16 mm sensor
        translate([radar_center_x - 11.25, -1.0, radar_center_z - 8.25])
            cube([22.5, wall_th + 2.0, 16.5]);
            
        // Decorative Bezel Recess on Front Face (Matching Render)
        translate([radar_center_x - 16.0, -0.1, radar_center_z - 12.0])
            cube([32.0, 1.2, 24.0]);
            
        // C. 3x Status LEDs (Right - 10 mm LEDs)
        led_x = 148.0;
        // Status LED (Top - Green)
        translate([led_x, -1.0, 43.0])
            rotate([-90, 0, 0]) cylinder(d=led_hole_d, h=wall_th + 2.0);
        // Wi-Fi LED (Middle - Blue)
        translate([led_x, -1.0, 30.0])
            rotate([-90, 0, 0]) cylinder(d=led_hole_d, h=wall_th + 2.0);
        // Load Alert LED (Bottom - Red)
        translate([led_x, -1.0, 17.0])
            rotate([-90, 0, 0]) cylinder(d=led_hole_d, h=wall_th + 2.0);

        // ====================================================================
        // REAR PANEL CUTOUTS (Y = box_width)
        // Calibrated with verified clearance from corner support pillars (X=3..13 and X=157..167)
        // ====================================================================
        
        // 1. DC Power Input Barrel Jack (X = 20: 1.4 mm clear of left pillar at X=13)
        translate([20.0, box_width - wall_th - 1.0, 22.0])
            rotate([-90, 0, 0]) cylinder(d=11.2, h=wall_th + 2.0);
            
        // 2. Master Power Switch (KCD1 Rocker: 20 mm x 14 mm bezel -> 19.5 x 13.0 mm cutout, centered at X=39)
        translate([39.0 - 9.75, box_width - wall_th - 1.0, 22.0 - 6.5])
            cube([19.5, wall_th + 2.0, 13.0]);

        // 3. Panel-Mount Fuse Holder (for 5x20 mm T5AH250V fuse: 12.2 mm dia hole, centered at X=57)
        translate([57.0, box_width - wall_th - 1.0, 22.0])
            rotate([-90, 0, 0]) cylinder(d=12.2, h=wall_th + 2.0);

        // 4. 3P AC Power Male Plug C14 (55 mm x 22.5 mm x 20 mm, Centered at X = 85)
        iec_center_x = 85.0;
        iec_center_z = 22.0;
        // Body cutout through wall
        translate([iec_center_x - 14.0, box_width - wall_th - 1.0, iec_center_z - 10.5])
            cube([28.0, wall_th + 2.0, 21.0]);
        // Flange screw mounting holes (M3, 40 mm spacing)
        translate([iec_center_x - 20.0, box_width - wall_th - 1.0, iec_center_z])
            rotate([-90, 0, 0]) cylinder(d=3.2, h=wall_th + 2.0);
        translate([iec_center_x + 20.0, box_width - wall_th - 1.0, iec_center_z])
            rotate([-90, 0, 0]) cylinder(d=3.2, h=wall_th + 2.0);

        // 5. 3x Cable Glands (Outlets 1, 2, 3 - PG7: 12.5 mm dia)
        // Positioned at X = 117, 131, 145 with 5.75 mm clearance from corner pillar at X=157
        translate([117.0, box_width - wall_th - 1.0, 22.0])
            rotate([-90, 0, 0]) cylinder(d=12.5, h=wall_th + 2.0);
        translate([131.0, box_width - wall_th - 1.0, 22.0])
            rotate([-90, 0, 0]) cylinder(d=12.5, h=wall_th + 2.0);
        translate([145.0, box_width - wall_th - 1.0, 22.0])
            rotate([-90, 0, 0]) cylinder(d=12.5, h=wall_th + 2.0);

        // ====================================================================
        // SIDE WALL VENTILATION GRILLES (Left: X = 0, Right: X = box_length)
        // High-airflow convection cooling louvers (thinner, multi-line array)
        // ====================================================================
        vent_y_center = box_width / 2.0; // Y = 55.0 mm (centered on side wall)
        vent_y_start  = vent_y_center - vent_slot_len / 2.0; // Y = 25.0 to 85.0 mm
        
        for (side_x = [-1.0, box_length - wall_th - 1.0]) {
            for (v_idx = [0 : vent_slots_num - 1]) {
                v_z = 12.0 + v_idx * (vent_slot_h + vent_rib_h);
                translate([side_x, vent_y_start + vent_slot_h/2.0, v_z])
                    rotate([0, 90, 0])
                        hull() {
                            cylinder(d=vent_slot_h, h=wall_th + 2.0);
                            translate([0, vent_slot_len - vent_slot_h, 0])
                                cylinder(d=vent_slot_h, h=wall_th + 2.0);
                        }
            }
        }
    }
}

// ============================================================================
// Top Cover Lid Model
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
                cylinder(d=lid_screw_d, h=lid_th + skirt_depth + 2.0);
            // Counterbore for M3 screw head flush fit
            translate([pos[0], pos[1], lid_th - lid_cb_depth])
                cylinder(d=lid_cb_d, h=lid_cb_depth + 0.5);
        }
    }
}

// ============================================================================
// Assembly / Render Dispatcher
// ============================================================================

if (part == "base") {
    enclosure_base();
} else if (part == "lid") {
    // Oriented for direct 3D printing (flat side down on print bed)
    rotate([180, 0, 0]) translate([0, -box_width, -lid_th]) enclosure_lid();
} else if (part == "assembly") {
    color("whitesmoke") enclosure_base();
    color("ghostwhite", 0.85) translate([0, 0, box_height]) enclosure_lid();
} else if (part == "exploded") {
    color("whitesmoke") enclosure_base();
    color("ghostwhite", 0.9) translate([0, 0, box_height + 30.0]) enclosure_lid();
}
