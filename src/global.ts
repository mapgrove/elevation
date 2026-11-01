import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fromArrayBuffer } from 'geotiff';
import { tileFor, MissingTileError, NoDataError, type Point } from './index.ts';

const BASE = 'https://copernicus-dem-90m.s3.amazonaws.com';
export const globalAttribution = '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
export type GlobalPlan = { sourceTileIds: string[]; missingTileIds: string[]; downloadBytes: null; unavailableTileIds: string[] };
export function sourceName(south: number, west: number) {
  return `Copernicus_DSM_COG_30_${south < 0 ? 'S' : 'N'}${String(Math.abs(south)).padStart(2,'0')}_00_${west < 0 ? 'W' : 'E'}${String(Math.abs(west)).padStart(3,'0')}_00_DEM`;
}
function sourceCell(p: Point) {
  tileFor(p);
  const lon = p.longitude === 180 ? -180 : p.longitude;
  // Source rasters retain north/west edges, but remove south/east edges.
  const south = Math.max(-90, Math.min(89, Math.ceil(p.latitude) - 1));
  return { south, west: Math.floor(lon), longitude: lon };
}
export async function loadGlobalCatalog(): Promise<Set<string>> {
  return new Set(JSON.parse(gunzipSync(await readFile(new URL('../data/global/catalog.json.gz',import.meta.url))).toString()));
}
export function createGlobalTerrain(options: {
  cacheDir: string;
  catalog: Set<string>;
  // Override only for mirrors or local integration tests.
  sourceUrl?: (id: string) => string;
}) {
  const catalog = new Set(options.catalog);
  const paths = (id: string) => ({ data:join(options.cacheDir,`${id}.tif`), meta:join(options.cacheDir,`${id}.json`) });
  async function cached(id: string) {
    const p=paths(id);
    let bytes: Buffer, metadata: {sha256:string;bytes:number};
    try { metadata=JSON.parse(await readFile(p.meta,'utf8')); bytes=await readFile(p.data); }
    catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT') return; throw e; }
    if(bytes.length!==metadata.bytes || sha(bytes)!==metadata.sha256) throw new Error(`Corrupt source cache: ${id}`);
    return bytes;
  }
  function required(points: Point[]) {
    const ids=new Set<string>();
    for(const p of points) {
      const c=sourceCell(p);
      ids.add(sourceName(c.south,c.west));
      // Conservative halo for nearest-neighbor rounding into removed edges.
      // Longitude spacing varies up to 30 arcseconds in polar source tiles.
      if(c.longitude-c.west>0.99) ids.add(sourceName(c.south,c.west===179?-180:c.west+1));
      if(p.latitude-c.south<1/1200 && c.south>-90) ids.add(sourceName(c.south-1,c.west));
      if(c.longitude-c.west>0.99 && p.latitude-c.south<1/1200 && c.south>-90) ids.add(sourceName(c.south-1,c.west===179?-180:c.west+1));
    }
    return [...ids].sort();
  }
  async function plan({points}:{points:Point[]}):Promise<GlobalPlan> {
    const sourceTileIds=required(points), missingTileIds:string[]=[], unavailableTileIds:string[]=[];
    for(const id of sourceTileIds) {
      if(!catalog.has(id)) unavailableTileIds.push(id);
      else if(!await cached(id)) missingTileIds.push(id);
    }
    return {sourceTileIds,missingTileIds,downloadBytes:null,unavailableTileIds};
  }
  async function download(p:GlobalPlan) {
    await mkdir(options.cacheDir,{recursive:true});
    for(const id of p.sourceTileIds) {
      if(!catalog.has(id)) continue;
      if(await cached(id)) continue;
      const url=options.sourceUrl?.(id)??`${BASE}/${id}/${id}.tif`;
      const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
      if(!response.ok) throw new Error(`Source download failed: ${id} HTTP ${response.status}`);
      const bytes=Buffer.from(await response.arrayBuffer());
      // Parse before publishing to the cache. Checksums pin bytes after first fetch;
      // they are not upstream authenticity checks or a provider-supplied digest.
      const tiff=await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      const image=await tiff.getImage();
      if(image.getGeoKeys().GeographicTypeGeoKey!==4326 || image.getWidth()<2 || image.getHeight()<2) throw new Error(`Unsupported source: ${id}`);
      const target=paths(id), suffix=`.${randomUUID()}.tmp`;
      try {
        await writeFile(target.data+suffix,bytes,{flag:'wx'});
        await writeFile(target.meta+suffix,JSON.stringify({sha256:sha(bytes),bytes:bytes.length,url}),{flag:'wx'});
        await rename(target.data+suffix,target.data);
        await rename(target.meta+suffix,target.meta);
      } finally {
        await unlink(target.data+suffix).catch(()=>{}); await unlink(target.meta+suffix).catch(()=>{});
      }
    }
  }
  async function getElevation(p:Point):Promise<number> {
    const c=sourceCell(p);
    let south=c.south, west=c.west, latitude=p.latitude, longitude=c.longitude;
    for(let attempt=0;attempt<3;attempt++) {
      const id=sourceName(south,west);
      if(!catalog.has(id)) throw new MissingTileError(`No source coverage: ${id}; absent tiles are not assumed ocean`);
      const bytes=await cached(id);
      if(!bytes) throw new MissingTileError(`Source download required: ${id}`);
      const tiff=await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      const image=await tiff.getImage();
      const [ox,oy]=image.getOrigin(), [rx,ry]=image.getResolution();
      if(image.getGeoKeys().GTRasterTypeGeoKey!==2 || rx<=0 || ry>=0) throw new Error('Expected north-up point-sampled Copernicus raster');
      const x=Math.round((longitude-ox)/rx), y=Math.round((latitude-oy)/ry);
      if(x>=image.getWidth()) { west=west===179?-180:west+1; longitude=west===-180?longitude-360:longitude; continue; }
      if(y>=image.getHeight() && south>-90) { south--; continue; }
      if(x<0 || y<0 || y>=image.getHeight()) throw new NoDataError('Coordinate is outside source sample support');
      const values=await image.readRasters({window:[x,y,x+1,y+1],samples:[0],interleave:true});
      const elevation=Number(values[0]);
      if(!Number.isFinite(elevation) || elevation===image.getGDALNoData()) throw new NoDataError('Missing source elevation sample');
      return elevation;
    }
    throw new NoDataError('Could not resolve source boundary');
  }
  async function getProfile(points:Point[]) {
    const profile:{point:Point;elevation:number}[]=[];
    for(const point of points) profile.push({point,elevation:await getElevation(point)});
    return profile;
  }
  return {plan,download,getElevation,getProfile};
}
