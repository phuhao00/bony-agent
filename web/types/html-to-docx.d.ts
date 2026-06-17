declare module "html-to-docx" {
  type DocxOptions = Record<string, unknown>;
  function HTMLtoDOCX(
    html: string,
    header: string | null,
    options?: DocxOptions,
    footer?: string,
  ): Promise<Buffer | Uint8Array | ArrayBuffer>;
  export default HTMLtoDOCX;
}
