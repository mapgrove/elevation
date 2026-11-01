# Copernicus GLO-90 global source mode

The bundled catalog indexes the AWS 2021 release of Copernicus GLO-90. Original raster files are fetched on demand from the public AWS bucket and cached on the user's machine, outside Git. The repository includes no global terrain raster archive.

© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM™-90.

No endorsement by Copernicus, ESA, DLR or Airbus is implied. Redistribution or communication of original or adapted data must retain applicable upstream notices and obligations. Adapted data needs the adapted-data notice, as used in the regional sample. The software's eventual license does not replace these data terms.

- [GLO-90 license, PDF pages 19–21](https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf)
- [AWS source documentation](https://copernicus-dem-90m.s3.amazonaws.com/readme.html)
- [Dataset registry](https://registry.opendata.aws/copernicus-dem/)

Surface heights include vegetation and infrastructure; sampling is not an accuracy guarantee. Heights use EGM2008. An absent source file is an explicit coverage error, never silently treated as zero. The global adapter returns nearest native samples, while the regional adapter interpolates its own grid. Online source availability is controlled by the external provider; only cached files are available offline.
