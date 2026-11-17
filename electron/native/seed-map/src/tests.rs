use super::*;

fn query(seed: &str, version: &str, dimension: &str) -> Value {
    json!({"protocol":1,"seed":seed,"version":version,"dimension":dimension,"y":64,"largeBiomes":false})
}
fn ids(map: &Map, x: i32, z: i32, step: i32, size: i32) -> Vec<u16> {
    let data = tile(map, &json!({"x":x,"z":z,"step":step,"size":size})).unwrap();
    let raw = STANDARD.decode(data["biomes"].as_str().unwrap()).unwrap();
    let rgba = STANDARD.decode(data["rgba"].as_str().unwrap()).unwrap();
    assert_eq!(raw.len(), (size * size * 2) as usize);
    assert_eq!(rgba.len(), (size * size * 4) as usize);
    assert!(rgba.chunks_exact(4).all(|p| p[3] == 255));
    raw.chunks_exact(2)
        .map(|p| u16::from_le_bytes([p[0], p[1]]))
        .collect()
}

#[test]
fn upstream_biome_vectors() {
    // Fixed upstream tests/test_biomes.c values, not snapshots of this wrapper.
    let mut q = query("-3829811542736183482", "26.3", "overworld");
    q["y"] = json!(77);
    assert_eq!(Map::new(&q).unwrap().biome(68148, 80990), 188);
    let mut q = query("12345", "1.18.2", "nether");
    q["y"] = json!(0);
    assert_eq!(Map::new(&q).unwrap().biome(0, 0), 8);
    let mut q = query("1551515151585454", "1.16.5", "end");
    q["y"] = json!(0);
    let map = Map::new(&q).unwrap();
    assert_eq!(map.biome(10000, 10000), 43);
    for (version, expected) in [("26.2", 43), ("26.3", 42)] {
        let map = Map::new(&query("856461443495910397", version, "end")).unwrap();
        for scale in [16, 64] {
            assert_eq!(
                ids(&map, -371136, -64, scale, 64)[0],
                expected,
                "{version}/{scale}"
            );
        }
    }
}

#[test]
fn upstream_structure_vectors_and_terrain_rejection() {
    // Fixed upstream tests/test_structures.c positions plus terrain result.
    let map = Map::new(&query("1551515151585454", "1.16.5", "nether")).unwrap();
    assert_eq!(
        map.feature(structure("ruined_portal_nether").unwrap(), 1, 0),
        Some((528, 160))
    );
    assert_eq!(
        map.feature(structure("fortress").unwrap(), 1, 0),
        Some((544, 32))
    );
    for version in [
        "1.9.4", "1.10.2", "1.11.2", "1.12.2", "1.13.2", "1.18.2", "26.3",
    ] {
        let map = Map::new(&query("6983438112510666596", version, "end")).unwrap();
        let position = map.feature(structure("end_city").unwrap(), -40, -17);
        let legacy = ["1.9.4", "1.10.2", "1.11.2", "1.12.2"].contains(&version);
        assert_eq!(
            position,
            if legacy { Some((-12768, -5424)) } else { None },
            "{version}"
        );
    }
}

#[test]
fn all_advertised_versions_generate_all_dimensions() {
    for version in VERSIONS {
        for dimension in ["overworld", "nether", "end"] {
            let map = Map::new(&query("-9223372036854775808", version, dimension)).unwrap();
            assert!(
                (0..256).contains(&map.biome(-37, 53)),
                "{version}/{dimension}"
            );
            assert_eq!(ids(&map, -64, -64, 4, 64).len(), 4096);
        }
    }
}

#[test]
fn tile_scales_dimensions_and_negative_seams() {
    for dimension in ["overworld", "nether", "end"] {
        let map = Map::new(&query("9223372036854775807", "26.3", dimension)).unwrap();
        for scale in [1, 4, 16, 64, 256] {
            assert_eq!(ids(&map, -256, -256, scale, 64).len(), 4096);
        }
        let a = ids(&map, -32, -32, 1, 64);
        let b = ids(&map, 0, -32, 1, 64);
        for row in 0..64 {
            assert_eq!(
                &a[row * 64 + 32..row * 64 + 64],
                &b[row * 64..row * 64 + 32]
            );
        }
        for (x, z) in [(-32, -32), (-1, -1), (0, 0), (31, 31)] {
            assert_eq!(a[((z + 32) * 64 + x + 32) as usize] as i32, map.biome(x, z));
        }
    }
    let map = Map::new(&query("0", "26.3", "overworld")).unwrap();
    assert_eq!(ids(&map, 0, 0, 4, 128).len(), 16384);
    assert_eq!(ids(&map, 0, 0, 4, 256).len(), 65536);
}

#[test]
fn seed_precision_large_biomes_and_vertical_changes() {
    let a = Map::new(&query("9007199254740992", "26.3", "overworld")).unwrap();
    let b = Map::new(&query("9007199254740993", "26.3", "overworld")).unwrap();
    assert_ne!(ids(&a, 0, 0, 64, 64), ids(&b, 0, 0, 64, 64));
    let mut q = query("12345", "26.3", "overworld");
    let regular = ids(&Map::new(&q).unwrap(), 0, 0, 64, 64);
    q["largeBiomes"] = json!(true);
    assert_ne!(regular, ids(&Map::new(&q).unwrap(), 0, 0, 64, 64));
    q["largeBiomes"] = json!(false);
    q["y"] = json!(-32);
    assert_ne!(regular, ids(&Map::new(&q).unwrap(), 0, 0, 64, 64));
}

#[test]
fn slime_matches_java_integer_rng() {
    // Independent Java Random LCG and signed-int arithmetic; tests negative and large chunks.
    fn java_slime(seed: i64, x: i32, z: i32) -> bool {
        let sum = seed
            .wrapping_add(x.wrapping_mul(x).wrapping_mul(4987142) as i64)
            .wrapping_add(x.wrapping_mul(5947611) as i64)
            .wrapping_add((z.wrapping_mul(z) as i64).wrapping_mul(4392871))
            .wrapping_add(z.wrapping_mul(389711) as i64);
        let mut state = ((sum as u64 ^ 987234911) ^ 0x5deece66d) & ((1 << 48) - 1);
        loop {
            state = state.wrapping_mul(0x5deece66d).wrapping_add(11) & ((1 << 48) - 1);
            let bits = (state >> 17) as i32;
            let value = bits % 10;
            if bits.wrapping_sub(value).wrapping_add(9) >= 0 {
                return value == 0;
            }
        }
    }
    for seed in [i64::MIN, -1, 0, 1, i64::MAX] {
        let map = Map::new(&query(&seed.to_string(), "26.3", "overworld")).unwrap();
        for x in [-1874999, -100000, -1, 0, 1, 65537, 1874999] {
            for z in [-1874999, -65537, -1, 0, 1, 100000, 1874999] {
                assert_eq!(
                    map.slime(x * 16, z * 16),
                    java_slime(seed, x, z),
                    "{seed}/{x}/{z}"
                );
            }
        }
    }
}

#[test]
fn features_and_locate_enforce_bounds_and_actual_viability() {
    let map = Map::new(&query("-3829811542736183482", "26.3", "overworld")).unwrap();
    let data = features(
        &map,
        &json!({"x0":-592,"z0":-592,"x1":592,"z1":592,"types":["abandoned_camp"],"limit":64}),
    )
    .unwrap();
    assert!(
        data["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["x"] == 224 && p["z"] == -384)
    );
    let result = locate(
        &map,
        &json!({"x":0,"z":0,"radius":2048,"limit":4,"kind":"structure","target":"village"}),
    )
    .unwrap();
    let items = result["items"].as_array().unwrap();
    assert!(!items.is_empty());
    assert!(items.len() <= 4);
    let mut previous = 0.;
    for p in items {
        let d = p["distance"].as_f64().unwrap();
        assert!(d >= previous && d <= 2048.);
        previous = d;
        let x = p["x"].as_i64().unwrap() as i32;
        let z = p["z"].as_i64().unwrap() as i32;
        assert_eq!(
            map.feature(
                structure("village").unwrap(),
                x.div_euclid(544),
                z.div_euclid(544)
            ),
            Some((x, z))
        );
    }
    let dense = features(
        &map,
        &json!({"x0":-65536,"z0":-65536,"x1":65536,"z1":65536,"types":["slime_chunk"],"limit":8}),
    )
    .unwrap();
    assert_eq!(dense["items"].as_array().unwrap().len(), 8);
    assert_eq!(dense["truncated"], true);
    let empty = features(
        &map,
        &json!({"x0":0,"z0":0,"x1":0,"z1":0,"types":["slime_chunk"],"limit":8}),
    )
    .unwrap();
    assert!(empty["items"].as_array().unwrap().is_empty());
    let unavailable = Map::new(&query("0", "1.21.1", "overworld")).unwrap();
    assert_eq!(
        unavailable.available(structure("abandoned_camp").unwrap()),
        0
    );
}

#[test]
fn biome_search_uses_requested_y_and_reports_sampling() {
    let map = Map::new(&query("12345", "26.3", "overworld")).unwrap();
    let id = map.biome(-16, 32);
    let data = locate(
        &map,
        &json!({"x":-16,"z":32,"radius":64,"limit":1,"kind":"biome","target":id.to_string()}),
    )
    .unwrap();
    assert_eq!(data["items"][0]["distance"], 0.);
    assert_eq!(data["items"][0]["y"], 64);
    assert_eq!(data["approximate"], true);
    assert_eq!(data["sampleStep"], 4);
}

#[test]
fn biome_catalog_lists_only_supported_release_versions() {
    let catalog = info().unwrap();
    let biomes = catalog["biomes"].as_array().unwrap();
    let versions = |id| biomes.iter().find(|b| b["id"] == id).unwrap()["versions"].clone();
    assert_eq!(versions(188), json!(["26.3"]));
    assert_eq!(versions(187), json!(["26.2", "26.3"]));
    assert!(!versions(186).as_array().unwrap().contains(&json!("1.21.3")));
    assert!(versions(186).as_array().unwrap().contains(&json!("1.21.4")));
    assert_eq!(versions(1).as_array().unwrap().len(), VERSIONS.len());
}

#[test]
fn strongholds_respect_historical_count_and_spawn_is_available() {
    for (version, count) in [("1.0.0", 3), ("1.8.9", 3), ("1.9.4", 128), ("26.3", 128)] {
        let map = Map::new(&query("0", version, "overworld")).unwrap();
        let points = map.strongholds();
        assert_eq!(points.len(), count, "{version}");
        assert!(
            points
                .iter()
                .all(|(x, z)| x.rem_euclid(16) == 4 && z.rem_euclid(16) == 4)
        );
        let data = features(&map,&json!({"x0":-30000,"z0":-30000,"x1":30000,"z1":30000,"types":["spawn","stronghold"],"limit":512})).unwrap();
        assert!(data.get("spawn").is_some());
        assert_eq!(data["items"].as_array().unwrap().len(), count + 1);
    }
}

#[test]
fn malformed_and_excessive_requests_fail_before_work() {
    assert!(run(json!({"protocol":2,"command":"info"})).is_err());
    for seed in [
        "9223372036854775808",
        "-9223372036854775809",
        "1.2",
        "abc",
        "",
    ] {
        assert!(Map::new(&query(seed, "26.3", "overworld")).is_err());
    }
    assert!(Map::new(&query("0", "27.1", "overworld")).is_err());
    assert!(Map::new(&query("0", "26.3", "moon")).is_err());
    let map = Map::new(&query("0", "26.3", "overworld")).unwrap();
    for coordinate in [-BOUND, BOUND] {
        let border=locate(&map,&json!({"x":coordinate,"z":coordinate,"radius":1024,"limit":32,"kind":"structure","target":"ruined_portal"})).unwrap();
        for p in border["items"].as_array().unwrap() {
            assert!(p["x"].as_i64().unwrap().abs() <= BOUND as i64);
            assert!(p["z"].as_i64().unwrap().abs() <= BOUND as i64);
        }
    }
    for params in [
        json!({"x":1,"z":0,"step":4,"size":128}),
        json!({"x":0,"z":0,"step":1,"size":255}),
        json!({"x":30000000,"z":0,"step":256,"size":64}),
    ] {
        assert!(tile(&map, &params).is_err());
    }
    assert!(
        features(
            &map,
            &json!({"x0":0,"z0":0,"x1":131073,"z1":0,"types":[],"limit":1})
        )
        .is_err()
    );
    assert!(
        locate(
            &map,
            &json!({"x":0,"z":0,"radius":16385,"limit":1,"kind":"biome","target":"plains"})
        )
        .is_err()
    );
    assert!(
        locate(
            &map,
            &json!({"x":0,"z":0,"radius":64,"limit":1,"kind":"biome","target":"nether_wastes"})
        )
        .is_err()
    );
}
