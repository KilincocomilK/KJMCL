fn main() {
    let mut b = cc::Build::new();
    b.include("vendor/cubiomes")
        .file("native/bridge.c")
        .warnings(false);
    for source in [
        "biomes",
        "noise",
        "biomenoise",
        "layers",
        "generator",
        "finders",
        "util",
        "terrainnoise",
        "features/abandoned_camp",
        "features/end_city",
        "features/fortress",
        "features/stronghold",
    ] {
        b.file(format!("vendor/cubiomes/{source}.c"));
    }
    if b.get_compiler().is_like_msvc() {
        b.flag("/std:c11")
            .flag("/fp:precise")
            .define("_CRT_SECURE_NO_WARNINGS", None);
    } else {
        b.flag("-std=c11").flag("-fwrapv").flag("-ffp-contract=off");
    }
    b.compile("kjmcl_cubiomes");
    println!("cargo:rerun-if-changed=native/bridge.c");
    println!("cargo:rerun-if-changed=vendor/cubiomes");
}
