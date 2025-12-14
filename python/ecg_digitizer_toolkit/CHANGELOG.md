# Changelog

## v0.2.0
- Added explicit ECGZIP schema version: `ecgzip-1.0`
- Added SHA-256 checksums in `metadata.json` (`checksums_sha256`)
- Added `validate_zip.py` for structure + checksum + signal sanity checks
- Rendering grid/aspect now derived from calibration (speed/gain)
- Digitizer now records QC metrics (trace coverage, baseline px, panel dims)

## v0.1.0
- Initial template-driven digitize + render scripts
