export interface PptxConversionProvider {
  /**
   * Returns true if the local environment has a supported converter installed.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Converts the input PPTX file to PDF.
   * @param inputPath Absolute path to the source .pptx file.
   * @param outputDir Absolute path to the temporary directory where the PDF should be written.
   * @param abortSignal Signal to cancel the conversion process.
   * @returns Resolves with the absolute path to the generated PDF.
   * @throws Error if conversion fails, times out, or is aborted.
   */
  convertToPdf(
    inputPath: string,
    outputDir: string,
    abortSignal?: AbortSignal
  ): Promise<string>;
}
