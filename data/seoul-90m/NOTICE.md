# Copernicus GLO-90 regional sample

These nine tiles cover [127.0, 127.3) longitude and [37.5, 37.8) latitude. They are an adapted surface-height dataset, not bare-earth survey heights. Buildings and vegetation can affect values. Sampling is 3 arcseconds, nominally 90 m; horizontal spacing varies with latitude. Vertical reference: EGM2008 (EPSG:3855), meters.

produced using Copernicus WorldDEM™-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM™-90.

No endorsement by Copernicus, ESA, DLR or Airbus is implied. Subsequent users who redistribute or communicate this adapted dataset must retain the applicable attribution, liability notice and obligations of the upstream license. The software's eventual license does not replace the data license.

- [Applicable license, GLO-90 section, PDF pages 19–21](https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf)
- [AWS dataset registry](https://registry.opendata.aws/copernicus-dem/)
- [AWS processing and edge conventions](https://copernicus-dem-90m.s3.amazonaws.com/readme.html)
- [Official dataset description and vertical reference](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)

Source accessed 2026-11-01; exact source URL and SHA-256 are recorded in manifest.json. The source is the AWS 2021 release. References test source-raster consistency only; they do not measure absolute terrain accuracy. No 30 m source data is redistributed in this repository.

The manifest's release URLs reserve the proposed future asset layout. They are not live: no hosted data release exists yet. The regional demo rewrites those URLs to a local HTTP server. A private GitHub release would require authenticated downloads; a public anonymous SDK must not depend on private release URLs.
