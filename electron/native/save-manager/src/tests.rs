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
    // macOS exposes its temporary directory through /var -> /private/var.
    // Match Store's canonical root without relaxing the engine's link checks.
    let base = std::env::temp_dir();
    #[cfg(unix)]
    let base = fs::canonicalize(base).unwrap();
    let dir = tempfile::tempdir_in(base).unwrap();
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
fn rule_changes_preserve_types_unknown_tags_and_undo_exact_bytes() {
    let d = fixture();
    let root = d.path();
    for (file, doc, key, version) in [
        (
            "level.dat",
            nbt!({"Data":{"DataVersion":3955i32,"GameRules":{"keepInventory":"false","customRule":"abc"}}}),
            "keepInventory",
            3955,
        ),
        (
            "level.dat",
            nbt!({"Data":{"DataVersion":4671i32,"game_rules":{"minecraft:keep_inventory":0i8,"mod:custom":42i32}}}),
            "minecraft:keep_inventory",
            4671,
        ),
        (
            crate::rules::SIDE,
            nbt!({"DataVersion":4786i32,"data":{"minecraft:keep_inventory":0i8,"mod:custom":42i32}}),
            "minecraft:keep_inventory",
            4786,
        ),
    ] {
        if file != "level.dat" {
            fs::write(
                root.join("level.dat"),
                gzip(&nbt!({"Data":{"DataVersion":version}})),
            )
            .unwrap();
        }
        let p = root.join(file);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        let original = gzip(&doc);
        fs::write(&p, &original).unwrap();
        let request = json!({"transaction":format!("rule-{version}"),"changes":[{"key":key,"before":"false","value":"true"}]});
        safety::edit_rules(root, &request).unwrap();
        assert_eq!(world::metadata(root).unwrap()["rules"][key], "true");
        let changed = world::read_nbt(root, file).unwrap();
        let map = if file != "level.dat" {
            nbt::get(&changed, "data").unwrap()
        } else {
            nbt::get(
                nbt::get(&changed, "Data").unwrap(),
                if version == 3955 {
                    "GameRules"
                } else {
                    "game_rules"
                },
            )
            .unwrap()
        };
        if version == 3955 {
            assert_eq!(nbt::get(map, key), Some(&Value::String("true".into())));
            assert_eq!(nbt::string(nbt::get(map, "customRule")), Some("abc"));
        } else {
            assert_eq!(nbt::get(map, key), Some(&Value::Byte(1)));
            assert_eq!(nbt::get(map, "mod:custom"), Some(&Value::Int(42)));
        }
        assert!(safety::edit_rules(root, &request).is_err());
        safety::undo(root, &request).unwrap();
        assert_eq!(fs::read(p).unwrap(), original);
    }
}
#[test]
fn sparse_rules_create_and_restore_modern_saved_data() {
    let d = fixture();
    let root = d.path();
    fs::write(
        root.join("level.dat"),
        gzip(&nbt!({"Data":{"DataVersion":4786i32}})),
    )
    .unwrap();
    let request = json!({"transaction":"implicit","changes":[{"key":"minecraft:random_tick_speed","before":"3","value":"0"}]});
    safety::edit_rules(root, &request).unwrap();
    let saved = world::read_nbt(root, crate::rules::SIDE).unwrap();
    assert_eq!(
        nbt::get(
            nbt::get(&saved, "data").unwrap(),
            "minecraft:random_tick_speed"
        ),
        Some(&Value::Int(0))
    );
    safety::undo(root, &request).unwrap();
    assert!(!root.join(crate::rules::SIDE).exists());
    assert_eq!(
        world::metadata(root).unwrap()["rules"]["minecraft:random_tick_speed"],
        "3"
    );
}
#[test]
fn cross_region_selection_uses_each_files_own_indices_and_one_journal() {
    let d = fixture();
    let root = d.path();
    let modern = root.join("dimensions/minecraft/overworld");
    fs::create_dir_all(&modern).unwrap();
    for kind in ["region", "entities", "poi"] {
        fs::rename(root.join(kind), modern.join(kind)).unwrap();
    }
    let a = modern.join("region/r.0.0.mca");
    let b = modern.join("region/r.-1.0.mca");
    region_file(&b, &[(0, chunk(false)), (1023, chunk(false))]);
    let before = (fs::read(&a).unwrap(), fs::read(&b).unwrap());
    assert_eq!(
        world::scan(root).unwrap()["dimensions"][0]["id"],
        "overworld"
    );
    let plan=safety::plan_many(root,&json!({"dimension":"overworld","groups":[{"rx":0,"rz":0,"indices":[0,1]},{"rx":-1,"rz":0,"indices":[1023]}],"protectSpawn":0})).unwrap();
    assert_eq!(plan["selected"].as_array().unwrap().len(), 2);
    assert_eq!(plan["skipped"].as_array().unwrap().len(), 1);
    safety::apply(root, &json!({"transaction":"both","plan":plan})).unwrap();
    assert_eq!(
        region::header(&a, 0, 0)
            .unwrap()
            .iter()
            .map(|c| c.index)
            .collect::<Vec<_>>(),
        vec![1, 1023]
    );
    assert_eq!(region::header(&b, -1, 0).unwrap()[0].index, 0);
    safety::undo(root, &json!({"transaction":"both"})).unwrap();
    assert_eq!((fs::read(a).unwrap(), fs::read(b).unwrap()), before);
}
#[test]
#[cfg(unix)]
fn linked_world_paths_are_rejected() {
    let d = fixture();
    let target = d.path().join("region");
    let link = d.path().join("linked-region");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    assert!(safety::check_absolute(&link).is_err());
    assert!(safety::join(d.path(), "linked-region/r.0.0.mca").is_err());
    assert!(safety::atomic(&link.join("new.mca"), b"blocked").is_err());
    assert!(!target.join("new.mca").exists());
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
fn metadata_reads_modern_and_legacy_world_generation() {
    let d = fixture();
    let modern = nbt!({"Data":{"LevelName":"巨型世界","WorldGenSettings":{"seed":i64::MIN,"dimensions":{"minecraft:overworld":{"generator":{"type":"minecraft:noise","settings":"minecraft:large_biomes"}}}},"SpawnX":-35i32,"SpawnY":70i32,"SpawnZ":10i32}});
    fs::write(d.path().join("level.dat"), gzip(&modern)).unwrap();
    let result = crate::run(json!({"protocol":1,"command":"metadata","root":d.path()})).unwrap();
    assert_eq!(result["data"]["seed"], i64::MIN.to_string());
    assert_eq!(result["data"]["generation"]["largeBiomes"], true);
    assert_eq!(
        result["data"]["generation"]["preset"],
        "minecraft:large_biomes"
    );
    assert_eq!(result["data"]["spawn"]["x"], -35);
    let legacy = nbt!({"Data":{"RandomSeed":i64::MAX,"generatorName":"largeBiomes"}});
    fs::write(d.path().join("level.dat"), gzip(&legacy)).unwrap();
    let result = world::metadata(d.path()).unwrap();
    assert_eq!(result["seed"], i64::MAX.to_string());
    assert_eq!(result["generation"]["largeBiomes"], true);
    let flat = nbt!({"Data":{"WorldGenSettings":{"seed":1i64,"dimensions":{"minecraft:overworld":{"generator":{"type":"minecraft:flat"}}}}}});
    fs::write(d.path().join("level.dat"), gzip(&flat)).unwrap();
    let result = world::metadata(d.path()).unwrap();
    assert_eq!(result["generation"]["largeBiomes"], false);
    assert_eq!(result["generation"]["preset"], "minecraft:flat");
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
    let pixels = nbt::surface(&chunk(false)).unwrap().pixels;
    assert_eq!(&pixels[0..4], &[125, 125, 127, 255]);
}
#[test]
fn preview_accepts_empty_companions_without_touching_the_world() {
    let d = fixture();
    let root = d.path();
    let entities = root.join("entities/r.0.0.mca");
    let poi = root.join("poi/r.0.0.mca");
    fs::write(&entities, []).unwrap();
    region_file(&poi, &[(1, chunk(false))]);
    let original_poi = fs::read(&poi).unwrap();
    let original = fs::read(root.join("region/r.0.0.mca")).unwrap();
    let plan = safety::plan(root, &request()).unwrap();
    assert_eq!(plan["selected"], json!([0, 1023]));
    assert_eq!(plan["files"].as_array().unwrap().len(), 1);
    assert!(!root.join("session.lock").exists());
    assert!(!root.join(".kjmcl-history").exists());
    assert_eq!(fs::read(root.join("region/r.0.0.mca")).unwrap(), original);
    safety::apply(root, &json!({"transaction":"empty","plan":plan})).unwrap();
    assert!(fs::read(&entities).unwrap().is_empty());
    assert_eq!(fs::read(&poi).unwrap(), original_poi);
    safety::undo(root, &json!({"transaction":"empty"})).unwrap();
    assert_eq!(fs::read(root.join("region/r.0.0.mca")).unwrap(), original);
}
#[test]
fn truncated_files_skip_their_region_and_preserve_all_its_bytes() {
    for kind in ["region", "entities", "poi"] {
        let d = fixture();
        let root = d.path();
        let file = root.join(format!("{kind}/r.0.0.mca"));
        fs::write(&file, [3; 4096]).unwrap();
        let terrain = root.join("region/r.0.0.mca");
        let original = fs::read(&terrain).unwrap();
        region_file(&root.join("region/r.-1.0.mca"), &[(0, chunk(false))]);
        let plan = safety::plan_many(root, &json!({"dimension":"overworld","groups":[{"rx":0,"rz":0,"indices":[0,1]},{"rx":-1,"rz":0,"indices":[0]}],"protectSpawn":0})).unwrap();
        assert_eq!(plan["selected"].as_array().unwrap().len(), 1);
        assert_eq!(plan["skipped"].as_array().unwrap().len(), 2);
        assert_eq!(plan["files"][0]["relative"], "region/r.-1.0.mca");
        safety::apply(root, &json!({"transaction":"healthy","plan":plan})).unwrap();
        assert_eq!(fs::read(file).unwrap(), vec![3; 4096]);
        assert_eq!(fs::read(terrain).unwrap(), original);
    }
}
#[test]
fn changed_unwritten_companions_invalidate_the_preview() {
    for mode in ["missing", "empty", "unselected"] {
        let d = fixture();
        let root = d.path();
        let file = root.join("entities/r.0.0.mca");
        match mode {
            "missing" => fs::remove_file(&file).unwrap(),
            "empty" => fs::write(&file, []).unwrap(),
            _ => region_file(&file, &[(1, chunk(false))]),
        }
        let terrain = root.join("region/r.0.0.mca");
        let before = fs::read(&terrain).unwrap();
        let plan = safety::plan(root, &request()).unwrap();
        region_file(&file, &[(0, chunk(false))]);
        assert!(safety::apply(root, &json!({"transaction":"stale","plan":plan})).is_err());
        assert_eq!(fs::read(terrain).unwrap(), before);
        assert!(!root.join(".kjmcl-history").exists());
    }
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
    let guard = safety::lock(d.path()).unwrap();
    assert!(
        safety::edit(
            d.path(),
            &json!({"patch":{"name":"locked"},"transaction":"no"})
        )
        .is_err()
    );
    drop(guard);
    safety::edit(
        d.path(),
        &json!({"patch":{"name":"unlocked"},"transaction":"after-unlock"}),
    )
    .unwrap();
    assert_eq!(world::metadata(d.path()).unwrap()["name"], "unlocked");
}
#[test]
fn distant_terrain_samples_real_occupied_chunks() {
    use base64::Engine;
    let d = fixture();
    for side in [1, 8, 32] {
        let tiles = region::terrain_tiles(
            d.path(),
            &json!({"dimension":"overworld","side":side,"regions":[{"rx":0,"rz":0}]}),
        )
        .unwrap();
        let pixels = base64::engine::general_purpose::STANDARD
            .decode(tiles[0]["pixels"].as_str().unwrap())
            .unwrap();
        assert_eq!(pixels.len(), side * side * 4);
        assert_eq!(&pixels[..4], &[125, 125, 127, 255]);
        if side > 1 {
            assert_eq!(pixels[(side - 1) * 4 + 3], 0);
        }
    }
}
#[test]
fn legacy_anvil_retains_surface_elevation_and_material() {
    let mut ids = vec![0i8; 4096];
    ids[2] = 9;
    ids[4 * 256 + 2] = 2;
    let legacy = nbt!({"Level":{"Sections":[{"Y":2i8,"Blocks":Value::ByteArray(fastnbt::ByteArray::new(ids))}]}});
    let surface = nbt::surface(&legacy).unwrap();
    assert_eq!(surface.heights[2], 36);
    assert_eq!(&surface.pixels[8..12], &[100, 143, 68, 255]);
    assert!(surface.palette.iter().any(|n| n == "minecraft:grass_block"));
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
