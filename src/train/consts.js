// Shared dimensions (train-local frame: +X = heading, +Y up, platform side = -Z, far side = +Z; car centre u along X).
export const PITCH = 15.2; // car pitch (LAYOUT.train.carLen)
export const HALF = 7.3; // half body length
export const HW = 1.4; // outer skin half width
export const IW = 1.3; // interior lining half width
export const FLOOR_Y = 0.008;
export const DOOR_H = 2.2;
export const DOOR_W = 1.4;
export const DOOR_U = [-4.4, 4.4]; // door centres within a car
export const LEAF_W = 0.72;
export const LEAF_SLIDE = 0.71;
export const WIN_Y0 = 0.9;
export const WIN_Y1 = 2.3;
export const LINING_TOP = 2.85;
export const CEIL_Y = 3.05;
export const ROOF_Y = 3.35;
export const ROOF_APEX = 3.62;
export const SKIRT_Y = -0.35;
export const WINDOWS = [[-2.75, -1.15], [-0.8, 0.8], [1.15, 2.75], [5.95, 6.95], [-6.95, -5.95]];
export const CAR_COUNT = 3;
export const TRAIN_HALF = ((CAR_COUNT - 1) * PITCH) / 2 + HALF; // 22.5 (nose distance from train centre)
export const WHEEL_R = 0.46;
export const AXLE_Y = -1.1 + WHEEL_R; // rail top y = LAYOUT.railTopY
export const BOGIE_U = 5.0;
export const AXLE_OFF = 0.9;
export const carU = (i) => (i - (CAR_COUNT - 1) / 2) * PITCH;
