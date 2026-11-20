fn main() {
    /* tauri::generate_context! 在编译期把 ../dist 整个嵌进 lib。
       但 tauri-build 没给 dist 发 rerun-if-changed，cargo 认为 crate 没变，
       配合 rust-cache 就会出现「前端改了、APK 字节一模一样」的情况（实测 .so
       md5 连续两次相同）。这里显式声明依赖：dist 里文件增删（vite 的文件名带
       hash，内容一变就是新文件名）都会让本 crate 重编。 */
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-changed=../dist/assets");
    tauri_build::build()
}
