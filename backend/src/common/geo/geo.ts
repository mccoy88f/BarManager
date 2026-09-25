/**
 * Distanza in metri fra due coordinate (formula haversine). Condivisa fra
 * la timbratura GPS (attendance.service.ts) e gli ordini online (§5.10 di
 * DEVELOPMENT.md), che la usa per validare il raggio massimo di consegna a
 * partire dalle stesse coordinate del locale (Venue.gpsLat/gpsLng).
 */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
