import type { PickedExif } from '../../types/photo.js'

export function convertExifGPSToDecimal(
  exif: PickedExif | null,
): { latitude: number; longitude: number } | null {
  if (!exif) return null
  let latitude: number | null = null
  let longitude: number | null = null

  if (typeof exif.GPSLatitude === 'number') {
    latitude = exif.GPSLatitude
  } else if (exif.GPSLatitude) {
    const num = Number(exif.GPSLatitude)
    latitude = Number.isFinite(num) ? num : null
  }

  if (typeof exif.GPSLongitude === 'number') {
    longitude = exif.GPSLongitude
  } else if (exif.GPSLongitude) {
    const num = Number(exif.GPSLongitude)
    longitude = Number.isFinite(num) ? num : null
  }

  if (latitude === null || longitude === null) return null

  const latSouth =
    exif.GPSLatitudeRef === 'S' || exif.GPSLatitudeRef === 'South'
  const lonWest =
    exif.GPSLongitudeRef === 'W' || exif.GPSLongitudeRef === 'West'

  const lat = latSouth ? -Math.abs(latitude) : Math.abs(latitude)
  const lon = lonWest ? -Math.abs(longitude) : Math.abs(longitude)

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { latitude: lat, longitude: lon }
}
