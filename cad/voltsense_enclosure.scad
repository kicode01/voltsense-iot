// ============================================================================
// VoltSense Smart Power Monitor - Parametric 3D Enclosure
// Calibrated from user's custom "final" layout with verified dimensions:
//   - Outer Dimensions: 170.0 mm (W) x 110.0 mm (D) x 63.5 mm (H assembled)
//   - Base Chassis Height: 60.0 mm (+ 3.5 mm bottom foot pads)
//   - Top Lid Plate: 3.5 mm (+ 3.5 mm alignment skirt interlocking into base)
//   - 3x Status LEDs: 10.0 mm (10.2 mm cutout diameter for panel bezels / 3D print fit)
//   - Side Ventilation Grilles: 9x 2.5 mm thin convection slots (60 mm span, bottom to top)
//   - 3x Output Cord Pass-Throughs: 12.5 mm (Rubber Grommets for Powerflex Royal Cord SJT 1.25 mm² x 3C / #16/3)
//   - Cable Pass-Through Positions: X = 116, 131, 146 mm (4.75 mm solid clearance from corner pillar at X=157)
//   - Front Panel Features: Embossed "VOLTSENSE" logo, HC-SR501 PIR dome & PCB seat,
//     mmWave radar window with decorative bezel, embossed "STATUS", "WIFI", "LOAD" LED labels
//   - Rear Panel Cutouts: DC barrel jack (11.2 mm), Rocker switch (19.5 x 13 mm),
//     Panel fuse holder (12.2 mm), C14 AC inlet (28 x 21 mm body with M3 screw holes)
//   - Internal Safety Barrier: High-voltage (HV rear) / Low-voltage (LV front) isolation wall
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

/* [Panel Cutouts] */
led_hole_d    =  10.2; // 10 mm status LEDs with 0.2 mm clearance
led_x         = 145.5; // Aligned with user final front panel layout

/* [Side Ventilation Grilles] */
vent_slot_len =  60.0; // Horizontal length of vent slot along Y (mm)
vent_slot_h   =   2.5; // Thinner slot opening height (2.5 mm: sleek, finger-safe, debris resistant)
vent_rib_h    =   2.5; // Solid wall bridge between slots (mm)
vent_slots_num=     9; // 9 horizontal slots extending from Z = 12 mm bottom to Z = 52 mm top
vent_y_start  = (box_width - vent_slot_len) / 2.0; // Centered at Y = 55.0 mm (Y: 25..85 mm)

/* [Rear Cable Grommets] */
grommet_hole_d = 12.5; // Rubber grommet cutout for SJT 1.25 mm² x 3C (#16/3, 8.5 mm OD)
grommet_z      = 22.0; // Z center height
grommet_x_pos  = [116.0, 131.0, 146.0]; // 15 mm pitch; Outlet 3 has 4.75 mm clearance from pillar at X=157

$fn = 60; // Smooth arc resolution for circles

// ============================================================================
// Modified Base Model (Derived directly from user's "final" CAD layout)
// ============================================================================

module enclosure_base_modified() {
    difference() {
        union() {
            // 1. User's exact final base model geometry with embossed logos, labels & standoffs
            import("user_final_backup/voltsense_enclosure_base_final.stl");
            
            // 2. Patch / fill old thick side slots on Left Wall (X = 0)
            translate([-0.1, 24.0, 20.0])
                cube([wall_th + 0.2, 62.0, 28.0]);
                
            // 3. Patch / fill old thick side slots on Right Wall (X = 170)
            translate([box_length - wall_th - 0.1, 24.0, 20.0])
                cube([wall_th + 0.2, 62.0, 28.0]);
                
            // 4. Patch / fill old 3 rear cable holes (Y = 110)
            translate([114.0, box_width - wall_th - 0.1, 14.0])
                cube([48.0, wall_th + 0.2, 16.0]);
        }
        
        // --- SUBTRACTIONS (User's requested updates) ---
        
        // A. 3x Status LEDs (Updated to 10.2 mm diameter for 10 mm LEDs)
        for (led_z = [43.0, 30.0, 17.0]) {
            translate([led_x, -1.0, led_z])
                rotate([-90, 0, 0])
                    cylinder(d=led_hole_d, h=wall_th + 2.0);
        }
        
        // B. 3x Shifted Rear Cable Pass-Throughs for SJT 16/3 Rubber Grommets (12.5 mm dia)
        // Positioned at X = 116, 131, 146 mm; clears corner pillar at X=157 by 4.75 mm
        for (hx = grommet_x_pos) {
            translate([hx, box_width - wall_th - 1.0, grommet_z])
                rotate([-90, 0, 0])
                    cylinder(d=grommet_hole_d, h=wall_th + 2.0);
        }
        
        // C. Thinner Side Ventilation Louvers (9 slots, 2.5 mm tall, 60 mm long, bottom to top)
        for (side_x = [-1.0, box_length - wall_th - 1.0]) {
            for (i = [0 : vent_slots_num - 1]) {
                v_z = 12.0 + i * (vent_slot_h + vent_rib_h);
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
// Top Cover Lid Model (Directly from user's final CAD)
// ============================================================================

module enclosure_lid_final() {
    import("user_final_backup/voltsense_enclosure_lid_final.stl");
}

// ============================================================================
// Assembly / Render Dispatcher
// ============================================================================

if (part == "base") {
    enclosure_base_modified();
} else if (part == "lid") {
    // Oriented for direct 3D printing
    rotate([180, 0, 0]) translate([0, -box_width, -lid_th]) enclosure_lid_final();
} else if (part == "assembly") {
    color("whitesmoke") enclosure_base_modified();
    color("ghostwhite", 0.9) translate([0, 0, 56.5]) enclosure_lid_final();
} else if (part == "exploded") {
    color("whitesmoke") enclosure_base_modified();
    color("ghostwhite", 0.95) translate([0, 0, 56.5 + 30.0]) enclosure_lid_final();
}
