// The one way to change a staff member's points: changePoints() is a single atomic update (clamped at zero) that also
// writes a row in the points ledger. Implemented in src/core/points.ts; import it from here in services.
export { changePoints, adjustStaffPoints, pointsBreakdown, registerPointRule, ratingPoints } from '../core/points.js';
export type { ChangePointsInput, ChangePointsResult, PointSource } from '../core/points.js';
