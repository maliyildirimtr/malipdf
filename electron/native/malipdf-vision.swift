// MaliPDF text recognition helper (macOS Vision framework).
//
// Reads an image and prints the recognised text as JSON on stdout:
//   {"lines":[{"text":"…","confidence":0.97,"box":[x,y,w,h],
//              "words":[{"text":"…","box":[x,y,w,h]}]}]}
// Boxes are normalised (0…1) with the origin at the TOP-LEFT of the image.
// Printed text and handwriting both work (Vision's "accurate" level).
//
// Usage: malipdf-vision --image <path> [--languages tr-TR,en-US] [--fast]
//        malipdf-vision --languages-supported
//
// Built by scripts/buildVisionHelper.mjs (swiftc, macOS only).

import Foundation
import Vision
import AppKit

struct Word: Encodable { let text: String; let box: [Double] }
struct Line: Encodable { let text: String; let confidence: Double; let box: [Double]; let words: [Word] }
struct Output: Encodable { let lines: [Line] }

func fail(_ message: String, _ code: Int32 = 1) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(code)
}

func topLeft(_ r: CGRect) -> [Double] {
  // Vision: origin bottom-left. Output: origin top-left.
  return [Double(r.origin.x), Double(1 - r.origin.y - r.size.height), Double(r.size.width), Double(r.size.height)]
}

var imagePath: String?
var languages: [String] = ["tr-TR", "en-US"]
var fast = false
var listLanguages = false
var args = CommandLine.arguments.dropFirst().makeIterator()
while let arg = args.next() {
  switch arg {
  case "--image": imagePath = args.next()
  case "--languages": languages = (args.next() ?? "").split(separator: ",").map(String.init)
  case "--fast": fast = true
  case "--languages-supported": listLanguages = true
  default: fail("Unknown argument: \(arg)", 2)
  }
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = fast ? .fast : .accurate
request.usesLanguageCorrection = true
if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }

var supported: [String] = []
if #available(macOS 12.0, *) {
  supported = (try? request.supportedRecognitionLanguages()) ?? []
} else {
  supported = (try? VNRecognizeTextRequest.supportedRecognitionLanguages(for: .accurate, revision: VNRecognizeTextRequestRevision2)) ?? []
}
if listLanguages {
  let data = try! JSONEncoder().encode(supported)
  FileHandle.standardOutput.write(data)
  exit(0)
}
let wanted = languages.filter { supported.contains($0) }
if !wanted.isEmpty { request.recognitionLanguages = wanted }

guard let path = imagePath else { fail("Missing --image", 2) }
guard let image = NSImage(contentsOfFile: path),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fail("Could not read image: \(path)", 3)
}

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
  try handler.perform([request])
} catch {
  fail("Recognition failed: \(error.localizedDescription)", 4)
}

var lines: [Line] = []
for observation in (request.results ?? []) {
  guard let candidate = observation.topCandidates(1).first else { continue }
  let text = candidate.string
  var words: [Word] = []
  // One box per word (split on spaces) so selection and search are precise.
  var index = text.startIndex
  while index < text.endIndex {
    while index < text.endIndex, text[index].isWhitespace { index = text.index(after: index) }
    if index >= text.endIndex { break }
    var end = index
    while end < text.endIndex, !text[end].isWhitespace { end = text.index(after: end) }
    let range = index..<end
    if let box = try? candidate.boundingBox(for: range) {
      words.append(Word(text: String(text[range]), box: topLeft(box.boundingBox)))
    }
    index = end
  }
  lines.append(Line(text: text, confidence: Double(candidate.confidence), box: topLeft(observation.boundingBox), words: words))
}

let encoder = JSONEncoder()
guard let data = try? encoder.encode(Output(lines: lines)) else { fail("Could not encode the result", 5) }
FileHandle.standardOutput.write(data)
