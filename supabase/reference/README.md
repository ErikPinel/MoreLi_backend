# Reference datasets

These files are retained for offline comparison and import research. They are not runtime application data and must not be loaded directly by the client.

## `legacy-israel-settlements.geojson`

This is a legacy point dataset with 1,240 settlement features in `CRS84` coordinates. Local validation found:

- 66 features with a blank Hebrew label.
- 68 features with a blank English label.
- One duplicate Hebrew name.
- Stale municipality names, including the former name for Nof HaGalil.
- Only 11 exact Hebrew-name matches against the current 13-city application seed.

Do not import this file into `public.cities` as-is. A future city expansion should start from a current authoritative source, normalize municipality names, remove unlabeled or obsolete settlements, and assign stable external settlement codes before an idempotent migration is created.
