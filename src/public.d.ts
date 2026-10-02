// The site-root files imported `with { type: "file" }` in server.ts: each import is the file's path,
// on disk when run from source and inside the executable when compiled.
declare module "@public/*" {
  const path: string;
  export default path;
}
