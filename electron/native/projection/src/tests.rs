use crate::{
    formats,
    model::{Block, Project, index, pos, transform_block},
    run,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use fastnbt::{LongArray, Value as N, nbt};
use serde_json::json;
use std::{collections::BTreeMap, fs, io::Write};
fn gzip(v: &N) -> Vec<u8> {
    let mut e = flate2::write::GzEncoder::new(vec![], flate2::Compression::fast());
    e.write_all(&fastnbt::to_bytes(v).unwrap()).unwrap();
    e.finish().unwrap()
}
fn fixture() -> Vec<u8> {
    gzip(
        &nbt!({"Version":7i32,"MinecraftDataVersion":4189i32,"Metadata":{"Name":"原始名称","Author":"作者","Custom":73i64},"RootExtension":{"Keep":"yes"},"Regions":{"负区":{"Position":{"x":8i32,"y":-2i32,"z":-7i32},"Size":{"x":-5i32,"y":3i32,"z":-7i32},"BlockStatePalette":[{"Name":"minecraft:air"},{"Name":"minecraft:oak_stairs","Properties":{"facing":"north","half":"bottom","shape":"straight","waterlogged":"false"}}],"BlockStates":LongArray::new(formats::pack(&(0..105).map(|i|if i%3==0{0}else{1}).collect::<Vec<_>>(),2)),"TileEntities":Vec::<N>::new(),"Entities":Vec::<N>::new(),"PendingBlockTicks":Vec::<N>::new(),"PendingFluidTicks":Vec::<N>::new(),"UnknownRegion":"retained"}}}),
    )
}
fn project() -> Project {
    let bytes = fixture();
    let mut p = formats::import(&bytes, "投影").unwrap();
    p.original = STANDARD.encode(bytes);
    p
}
fn parse(bytes: &[u8]) -> N {
    let d = flate2::read::GzDecoder::new(bytes);
    let raw = std::io::read_to_string(d);
    assert!(raw.is_err());
    let mut d = flate2::read::GzDecoder::new(bytes);
    let mut raw = vec![];
    std::io::Read::read_to_end(&mut d, &mut raw).unwrap();
    fastnbt::from_bytes(&raw).unwrap()
}
fn get<'a>(v: &'a N, k: &str) -> &'a N {
    if let N::Compound(m) = v {
        &m[k]
    } else {
        panic!()
    }
}
#[test]
fn signed_region_coordinates_and_materials() {
    let p = project();
    assert_eq!(p.origin, [4, -2, -13]);
    assert_eq!(p.dimensions, [5, 3, 7]);
    assert_eq!(p.view()["nonAir"], 70);
    assert_eq!(p.blocks[1], 1);
    assert_eq!(p.view()["materials"][0]["count"], 70);
}
#[test]
fn bit_storage_crosses_long_and_varints_reject_truncation() {
    for palette in [2, 3, 5, 17, 257, 65536] {
        let ids = (0..1000).map(|i| (i % palette) as u32).collect::<Vec<_>>();
        assert_eq!(
            formats::unpack(&formats::pack(&ids, palette), ids.len(), palette).unwrap(),
            ids
        )
    }
    assert!(formats::unpack(&[0], 100, 5).is_err());
    assert!(formats::varints(&[128], 1, 2).is_err());
    assert!(formats::varints(&[255, 255, 255, 255, 255, 0], 1, 2).is_err());
}
#[test]
fn formats_round_trip_geometry_and_blockstates() {
    let p = project();
    for format in ["schem", "nbt", "litematic"] {
        let bytes = formats::export(&p, format).unwrap();
        let q = formats::import(&bytes, "result").unwrap();
        assert_eq!(q.dimensions, p.dimensions);
        for i in 0..p.blocks.len() {
            assert_eq!(
                q.palette[q.blocks[i] as usize],
                p.palette[p.blocks[i] as usize]
            );
        }
    }
}
#[test]
fn same_format_edits_preserve_metadata_and_original_regions() {
    let mut p = project();
    p.edit(&json!({"kind":"replace","indices":[0],"block":{"name":"minecraft:diamond_block"}}))
        .unwrap();
    let q = parse(&formats::export(&p, "litematic").unwrap());
    assert_eq!(get(get(&q, "Metadata"), "Custom"), &N::Long(73));
    assert_eq!(
        get(get(&q, "RootExtension"), "Keep"),
        &N::String("yes".into())
    );
    assert_eq!(
        get(get(get(&q, "Regions"), "负区"), "UnknownRegion"),
        &N::String("retained".into())
    );
}
#[test]
fn protocol_preserves_exact_source_and_enforces_exclusive_output() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.litematic");
    fs::write(&source, fixture()).unwrap();
    let managed = dir.path().join("managed.json");
    let out = dir.path().join("export.litematic");
    run(json!({"protocol":1,"command":"import","input":source,"output":managed})).unwrap();
    run(json!({"protocol":1,"command":"export","input":managed,"output":out,"format":"litematic"}))
        .unwrap();
    assert_eq!(fs::read(&source).unwrap(), fs::read(&out).unwrap());
    assert!(run(json!({"protocol":1,"command":"export","input":managed,"output":out,"format":"litematic"})).is_err());
}
#[test]
fn rotations_mirrors_and_direction_properties_are_reversible() {
    let original = project();
    let mut p = original.clone();
    for _ in 0..4 {
        p.edit(&json!({"kind":"rotate","direction":"cw"})).unwrap();
    }
    assert_eq!(p.blocks, original.blocks);
    assert_eq!(p.palette, original.palette);
    for _ in 0..2 {
        p.edit(&json!({"kind":"mirror","axis":"x"})).unwrap();
    }
    assert_eq!(p.blocks, original.blocks);
    assert_eq!(p.palette, original.palette);
    let mut b = Block {
        name: "minecraft:redstone_wire".into(),
        properties: BTreeMap::from([
            ("north".into(), "side".into()),
            ("east".into(), "none".into()),
            ("south".into(), "up".into()),
            ("west".into(), "none".into()),
        ]),
    };
    transform_block(&mut b, 0);
    assert_eq!(b.properties["east"], "side");
    assert_eq!(b.properties["west"], "up");
    assert_eq!(b.properties.len(), 4);
}
#[test]
fn real_selection_and_delete_follow_voxel_coordinates() {
    let mut p = project();
    let layer = p.select(&json!({"mode":"layer","index":1})).unwrap();
    assert!(layer.iter().all(|&i| pos(i, p.dimensions)[1] == 0));
    let selected = p
        .select(&json!({"mode":"box","min":[0,0,0],"max":[2,1,2]}))
        .unwrap();
    assert!(!selected.is_empty());
    assert!(selected.iter().all(|&i| {
        pos(i, p.dimensions)
            .iter()
            .zip([2, 1, 2])
            .all(|(&n, max)| n <= max)
    }));
    p.edit(&json!({"kind":"delete","indices":selected}))
        .unwrap();
    assert!(p.palette[p.blocks[index([1, 0, 0], p.dimensions)] as usize].is_air());
    assert!(
        p.select(&json!({"mode":"box","min":[0,0,0],"max":[9,9,9]}))
            .is_err()
    );
}
#[test]
fn refuses_corruption_and_unbounded_dimensions() {
    assert!(formats::import(&[31, 139, 0, 0], "bad").is_err());
    assert!(crate::model::volume([2048, 2048, 2048]).is_err());
    assert!(crate::model::volume([0, 1, 1]).is_err());
    let mut p = project();
    p.blocks[0] = 9999;
    assert!(p.validate().is_err());
}

#[test]
fn containers_and_planned_ticks_rotate_without_losing_payload() {
    let mut source = parse(&fixture());
    let N::Compound(root) = &mut source else {
        panic!()
    };
    let N::Compound(regions) = root.get_mut("Regions").unwrap() else {
        panic!()
    };
    let N::Compound(region) = regions.get_mut("负区").unwrap() else {
        panic!()
    };
    region.insert("TileEntities".into(),N::List(vec![nbt!({"id":"minecraft:chest","x":1i32,"y":0i32,"z":0i32,"Items":[{"Slot":0i8,"id":"minecraft:diamond","count":17i32}],"Lock":"mine","ModPayload":123456789i64})]));
    region.insert("PendingBlockTicks".into(),N::List(vec![nbt!({"Block":"minecraft:oak_stairs","x":1i32,"y":0i32,"z":0i32,"Time":40i64,"Priority":2i32})]));
    let bytes = gzip(&source);
    let mut p = formats::import(&bytes, "container").unwrap();
    p.original = STANDARD.encode(bytes);
    let mut replaced = p.clone();
    replaced
        .edit(&json!({"kind":"replace","indices":[1],"block":{"name":"minecraft:stone"}}))
        .unwrap();
    replaced.edit(&json!({"kind":"replace","indices":[1],"block":{"name":"minecraft:oak_stairs","properties":{"facing":"north","half":"bottom","shape":"straight","waterlogged":"false"}}})).unwrap();
    let replaced_output = parse(&formats::export(&replaced, "litematic").unwrap());
    assert_eq!(
        get(
            get(get(&replaced_output, "Regions"), "负区"),
            "TileEntities"
        ),
        &N::List(vec![])
    );
    p.edit(&json!({"kind":"rotate","direction":"cw"})).unwrap();
    assert_eq!(p.attached[0].pos, [6, 0, 1]);
    let output = parse(&formats::export(&p, "litematic").unwrap());
    let region = get(get(&output, "Regions"), "KJMCL");
    let N::List(entities) = get(region, "TileEntities") else {
        panic!()
    };
    assert_eq!(get(&entities[0], "x"), &N::Int(6));
    assert_eq!(get(&entities[0], "z"), &N::Int(1));
    assert_eq!(get(&entities[0], "ModPayload"), &N::Long(123456789));
    let N::List(items) = get(&entities[0], "Items") else {
        panic!()
    };
    assert_eq!(get(&items[0], "count"), &N::Int(17));
    let N::List(ticks) = get(region, "PendingBlockTicks") else {
        panic!()
    };
    assert_eq!(get(&ticks[0], "x"), &N::Int(6));
    assert_eq!(get(&ticks[0], "Time"), &N::Long(40));
    assert!(formats::export(&p, "schem").is_err());
    let selected = index([6, 0, 1], p.dimensions);
    p.edit(&json!({"kind":"delete","indices":[selected]}))
        .unwrap();
    assert!(p.attached.is_empty());
}

#[test]
fn rejects_recursive_nbt_before_deserialization_and_negative_sponge_sizes() {
    let mut raw = vec![10, 0, 0];
    for _ in 0..70 {
        raw.extend([10, 0, 1, b'a']);
    }
    raw.extend(vec![0; 71]);
    assert!(
        formats::import(&raw, "deep")
            .err()
            .unwrap()
            .contains("NBT嵌套")
    );
    let mut p = project();
    let bytes = formats::export(&p, "schem").unwrap();
    let mut n = parse(&bytes);
    let N::Compound(m) = &mut n else { panic!() };
    let N::Compound(s) = m.get_mut("Schematic").unwrap() else {
        panic!()
    };
    s.insert("Width".into(), N::Short(-1));
    assert!(formats::import(&gzip(&n), "bad").is_err());
    p.edit(&json!({"kind":"replace","indices":[0],"block":{"name":"minecraft:stone"}}))
        .unwrap();
}
