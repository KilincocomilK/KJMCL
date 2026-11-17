#include "generator.h"
#include "finders.h"
#include "util.h"
#include <stdlib.h>
#include <string.h>

typedef struct { Generator g; SurfaceNoise end_surface; unsigned char colors[256][3]; } Map;
void *km_create(const char *version, int dim, uint64_t seed, int large) {
    int mc = str2mc(version);
    if (mc == MC_UNDEF) return NULL;
    Map *m = calloc(1, sizeof(Map));
    if (!m) return NULL;
    setupGenerator(&m->g, mc, large ? LARGE_BIOMES : 0);
    applySeed(&m->g, dim, seed);
    if (dim == DIM_END && mc >= MC_1_9) initSurfaceNoise(&m->end_surface, DIM_END, seed);
    initBiomeColors(m->colors);
    return m;
}
void km_free(void *ptr) { free(ptr); }
int km_biome(void *ptr, int x, int y, int z) { return getBiomeAt(&((Map*)ptr)->g, 1, x, y, z); }
const char *km_biome_name(void *ptr, int id) { return biome2str(((Map*)ptr)->g.mc, id); }
int km_biome_exists(void *ptr, int id) { return biomeExists(((Map*)ptr)->g.mc, id); }
int km_color(void *ptr, int id) { unsigned char *c=((Map*)ptr)->colors[id & 255]; return (c[0]<<16)|(c[1]<<8)|c[2]; }
int km_tile(void *ptr, int x, int z, int y, int step, int size, int *out) {
    Map *m=ptr;
    // Nether/End only support up to scale 64. Use exact point samples for 256.
    if (step == 256 && m->g.dim != DIM_OVERWORLD) {
        for (int j=0;j<size;j++) for (int i=0;i<size;i++) out[j*size+i]=getBiomeAt(&m->g,1,x+i*step,y,z+j*step);
        return 0;
    }
    Range r={0}; r.scale=step; r.x=x/step; r.z=z/step; r.sx=r.sz=size; r.y=step==1?y:(y>=0?y/4:(y-3)/4); r.sy=1;
    int *cache=allocCache(&m->g,r); if (!cache) return -1;
    int result=genBiomes(&m->g,cache,r);
    if (!result) memcpy(out,cache,size*size*sizeof(int));
    free(cache); return result;
}
int km_structure_region(void *ptr, int type) {
    Map *m=ptr; StructureConfig c;
    return getStructureConfig(type,m->g.mc,&c) && c.dim==m->g.dim ? (int)c.regionSize*16 : 0;
}
int km_structure(void *ptr,int type,int rx,int rz,int *x,int *z) {
    Map *m=ptr; Pos pos;
    if (!getStructurePos(type,m->g.mc,m->g.seed,rx,rz,&pos)) return 0;
    if (!isViableStructurePos(type,&m->g,pos.x,pos.z,0)) return 0;
    if (m->g.dim==DIM_OVERWORLD && m->g.mc>=MC_1_18 && !isViableStructureTerrain(type,&m->g,pos.x,pos.z)) return 0;
    if (type==End_City && !isViableEndCityTerrain(&m->g,&m->end_surface,pos.x,pos.z)) return 0;
    *x=pos.x; *z=pos.z; return 1;
}
int km_strongholds(void *ptr,int *out) {
    Map *m=ptr; if(m->g.dim!=DIM_OVERWORLD)return 0;
    StrongholdIter it; initFirstStronghold(&it,m->g.mc,m->g.seed);
    int count=0;
    while (count<128 && nextStronghold(&it,&m->g)>0) {
        out[count*2]=it.pos.x; out[count*2+1]=it.pos.z; count++;
    }
    return count;
}
void km_spawn(void *ptr,int *x,int *z) { Pos p=getSpawn(&((Map*)ptr)->g); *x=p.x; *z=p.z; }
int km_slime(void *ptr,int cx,int cz) { return isSlimeChunk(((Map*)ptr)->g.seed,cx,cz); }
