use crate::{nbt, region, safety, world};
use fastnbt::{Value, nbt};
use serde_json::json;
use std::{fs, io::Write, path::Path};
fn gzip(v: &Value) -> Vec<u8> {
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    enc.write_all(&fastnbt::to_bytes(v).unwrap()).unwrap();
    enc.finish().unwrap()
}
fn chunk(gateway: bool) -> Value {
    nbt!({"DataVersion":3955i32,"Status":"minecraft:full","InhabitedTime":1200i64,"sections":[{"Y":0i8,"block_states":{"palette":[{"Name":"minecraft:stone"}]}}],"block_entities":if gateway {vec![nbt!({"id":"minecraft:end_gateway"})]}else{vec![]}})
}
fn region_file(path: &Path, entries: &[(usize, Value)]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut bytes = vec![0; 8192];
    for (index, v) in entries {
        let data = gzip(v);
        let sectors = (data.len() + 5).div_ceil(4096);
        let loc = ((bytes.len() / 4096) as u32) << 8 | sectors as u32;
        bytes[index * 4..index * 4 + 4].copy_from_slice(&loc.to_be_bytes());
        bytes[4096 + index * 4..4100 + index * 4].copy_from_slice(&1000u32.to_be_bytes());
        let start = bytes.len();
        bytes.resize(start + sectors * 4096, 0);
        bytes[start..start + 4].copy_from_slice(&((data.len() + 1) as u32).to_be_bytes());
        bytes[start + 4] = 1;
        bytes[start + 5..start + 5 + data.len()].copy_from_slice(&data);
    }
    fs::write(path, bytes).unwrap();
}
fn fixture() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("level.dat"),gzip(&nbt!({"Data":{"LevelName":"世界 🟧","DataVersion":3955i32,"Version":{"Name":"1.21.1"},"WorldGenSettings":{"seed":9007199254740993i64},"GameType":0i32,"Difficulty":2i8,"hardcore":0i8,"allowCommands":0i8,"SpawnX":0i32,"SpawnY":64i32,"SpawnZ":0i32,"GameRules":{"keepInventory":"false"},"UnknownCustom":{"keep":123i64}}}))).unwrap();
    for kind in ["region", "entities", "poi"] {
        region_file(
            &dir.path().join(format!("{kind}/r.0.0.mca")),
            &[(0, chunk(false)), (1, chunk(true)), (1023, chunk(false))],
        );
    }
    dir
}
fn request() -> serde_json::Value {
    json!({"dimension":"overworld","rx":0,"rz":0,"indices":[0,1,1023],"protectSpawn":0})
}
#[test]
fn metadata_preserves_large_seed_and_unicode() {
    let d = fixture();
    let m = world::metadata(d.path()).unwrap();
    assert_eq!(m["name"], "世界 🟧");
    assert_eq!(m["seed"], "9007199254740993");
    assert_eq!(m["rules"]["keepInventory"], "false");
}
#[test]
fn parallel_scan_reads_headers_and_negative_coordinates() {
    let d = fixture();
    region_file(
        &d.path().join("DIM-1/region/r.-1.-2.mca"),
        &[(0, chunk(false))],
    );
    let scan = world::scan(d.path()).unwrap();
    assert_eq!(scan["dimensions"].as_array().unwrap().len(), 2);
    let c = region::header(&d.path().join("DIM-1/region/r.-1.-2.mca"), -1, -2).unwrap();
    assert_eq!((c[0].x, c[0].z), (-32, -64));
    assert_eq!(scan["dimensions"][0]["regions"][0]["chunks"], 3);
}
#[test]
fn terrain_and_cache_are_real_pixels() {
    let d = fixture();
    let cache = d.path().join("cache");
    fs::create_dir(&cache).unwrap();
    let mut r = request();
    r["cache"] = json!(cache);
    let first = region::inspect(d.path(), &r).unwrap();
    assert_eq!(first["cached"], false);
    assert!(
        first["image"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,")
    );
    assert_eq!(first["chunks"][0]["palette"][0], "minecraft:stone");
    assert_eq!(region::inspect(d.path(), &r).unwrap()["cached"], true);
    let (pixels, _) = nbt::surface(&chunk(false)).unwrap();
    assert_eq!(&pixels[0..4], &[125, 125, 127, 255]);
}
#[test]
fn preview_protects_spawn_gateways_and_unknown_filters() {
    let d = fixture();
    let mut r = request();
    r["protectSpawn"] = json!(8);
    let plan = safety::plan(d.path(), &r).unwrap();
    assert_eq!(plan["selected"], json!([1023]));
    assert_eq!(plan["skipped"].as_array().unwrap().len(), 2);
    r["maxInhabitedTicks"] = json!(1199);
    assert_eq!(safety::plan(d.path(), &r).unwrap()["selected"], json!([]));
}
#[test]
fn prune_syncs_terrain_entities_poi_and_undo_restores_exact_bytes() {
    let d = fixture();
    let file = d.path().join("region/r.0.0.mca");
    let original = fs::read(&file).unwrap();
    let plan = safety::plan(d.path(), &request()).unwrap();
    safety::apply(d.path(), &json!({"plan":plan,"transaction":"delete-one"})).unwrap();
    for kind in ["region", "entities", "poi"] {
        assert_eq!(
            region::header(&d.path().join(format!("{kind}/r.0.0.mca")), 0, 0)
                .unwrap()
                .iter()
                .map(|c| c.index)
                .collect::<Vec<_>>(),
            vec![1]
        );
    }
    safety::undo(d.path(), &json!({"transaction":"delete-one"})).unwrap();
    assert_eq!(fs::read(file).unwrap(), original);
    assert_eq!(safety::history(d.path()).unwrap()[0]["state"], "undone");
}
#[test]
fn stale_plan_and_changed_after_edit_are_rejected() {
    let d = fixture();
    let plan = safety::plan(d.path(), &request()).unwrap();
    let file = d.path().join("region/r.0.0.mca");
    let mut bytes = fs::read(&file).unwrap();
    bytes[4096] += 1;
    fs::write(&file, &bytes).unwrap();
    assert!(safety::apply(d.path(), &json!({"plan":plan,"transaction":"stale"})).is_err());
    let plan = safety::plan(d.path(), &request()).unwrap();
    safety::apply(d.path(), &json!({"plan":plan,"transaction":"edited"})).unwrap();
    bytes[4096] += 1;
    fs::write(&file, &bytes).unwrap();
    assert!(safety::undo(d.path(), &json!({"transaction":"edited"})).is_err());
}
#[test]
fn property_edits_preserve_unknown_nbt_and_recover_partial_journal() {
    let d = fixture();
    let original = fs::read(d.path().join("level.dat")).unwrap();
    safety::edit(
        d.path(),
        &json!({"patch":{"name":"新世界","difficulty":3},"transaction":"rename"}),
    )
    .unwrap();
    assert_eq!(world::metadata(d.path()).unwrap()["name"], "新世界");
    let n = world::level(d.path()).unwrap();
    assert_eq!(
        nbt::num(nbt::get(
            nbt::get(nbt::get(&n, "Data").unwrap(), "UnknownCustom").unwrap(),
            "keep"
        )),
        Some(123)
    );
    let journal = d.path().join(".kjmcl-history/rename/journal.json");
    let mut j: serde_json::Value = serde_json::from_slice(&fs::read(&journal).unwrap()).unwrap();
    j["state"] = json!("prepared");
    fs::write(journal, serde_json::to_vec(&j).unwrap()).unwrap();
    assert!(
        safety::edit(
            d.path(),
            &json!({"patch":{"name":"blocked"},"transaction":"next"})
        )
        .is_err()
    );
    safety::undo(d.path(), &json!({"transaction":"rename"})).unwrap();
    assert_eq!(fs::read(d.path().join("level.dat")).unwrap(), original);
}
#[test]
fn corrupt_headers_and_traversal_never_write() {
    let d = fixture();
    assert!(safety::join(d.path(), "../level.dat").is_err());
    assert!(safety::join(d.path(), "C:/escape").is_err());
    let p = d.path().join("region/r.0.0.mca");
    let mut b = fs::read(&p).unwrap();
    let overlap = b[0..4].to_vec();
    b[4..8].copy_from_slice(&overlap);
    fs::write(&p, b).unwrap();
    assert!(region::header(&p, 0, 0).unwrap_err().contains("重叠"));
    assert!(safety::plan(d.path(), &request()).is_err());
    assert!(region::coords("r.-2147483648.0.mca").is_none());
}
#[test]
fn external_chunks_are_read_but_not_removed() {
    let d = fixture();
    let p = d.path().join("region/r.0.0.mca");
    let mut bytes = vec![0; 12288];
    bytes[0..4].copy_from_slice(&513u32.to_be_bytes());
    bytes[8192..8196].copy_from_slice(&1u32.to_be_bytes());
    bytes[8196] = 129;
    fs::write(&p, bytes).unwrap();
    let ext = d.path().join("region/c.0.0.mcc");
    fs::write(&ext, gzip(&chunk(false))).unwrap();
    let c = region::header(&p, 0, 0).unwrap();
    assert!(region::decode(&p, &c[0]).is_ok());
    let compact = region::compact(&p, &[0].into_iter().collect()).unwrap();
    assert_eq!(compact.len(), 8192);
    assert!(ext.exists());
}
#[test]
fn locked_world_refuses_writes() {
    let d = fixture();
    let _guard = safety::lock(d.path()).unwrap();
    assert!(
        safety::edit(
            d.path(),
            &json!({"patch":{"name":"locked"},"transaction":"no"})
        )
        .is_err()
    );
}
#[test]
fn packed_indices_handle_padded_and_cross_word_formats() {
    assert_eq!(nbt::packed(&[0x3210], 3, 4, true), Some(3));
    let words = [(7u64 << 60) as i64, 1];
    assert_eq!(nbt::packed(&words, 12, 5, false), Some(23));
}
#[test]
fn java_lz4_checksums_and_lengths_are_validated() {
    let raw = fastnbt::to_bytes(&chunk(false)).unwrap();
    let compressed = lz4_flex::block::compress(&raw);
    let mut stream = b"LZ4Block".to_vec();
    stream.push(0x26);
    stream.extend((compressed.len() as u32).to_le_bytes());
    stream.extend((raw.len() as u32).to_le_bytes());
    stream.extend((xxhash_rust::xxh32::xxh32(&raw, 0x9747b28c) & 0x0fff_ffff).to_le_bytes());
    stream.extend(compressed);
    stream.extend(b"LZ4Block");
    stream.push(0x16);
    stream.extend([0u8; 12]);
    assert_eq!(nbt::inflate(&stream, 4).unwrap(), raw);
    stream[17] ^= 1;
    assert!(nbt::inflate(&stream, 4).is_err());
}
