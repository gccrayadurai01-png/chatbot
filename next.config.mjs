/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // There is a stray package-lock.json in the parent directory (~/), which makes
  // Next guess the wrong workspace root. Pin it to this project.
  outputFileTracingRoot: import.meta.dirname,
  // pdfkit ships its font metrics as .afm data files and resolves them by
  // relative path at runtime. Bundling it breaks that lookup with
  // "ENOENT ... data/Helvetica.afm", so load it from node_modules instead.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
