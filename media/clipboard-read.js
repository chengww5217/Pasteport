/*
 * macOS clipboard reader — JXA (`osascript -l JavaScript`).
 *
 * Usage:  osascript -l JavaScript clipboard-read.js <stagingDir>
 * Output: one JSON object on stdout, per src/clipboard/types.ts.
 *
 * Why an out-of-process script rather than a native addon: importing AppKit
 * through the ObjC bridge costs ~20ms and osascript itself ~10ms, so a full
 * read lands around 30ms — far below the perceptual threshold, with no build
 * toolchain, no prebuilt binaries per Node ABI, and no long-lived helper.
 *
 * Everything here is pure detection plus, for images, one file write. All
 * filtering that needs a stat lives in the TypeScript caller.
 */

/* eslint-disable */

function run(argv) {
  try {
    ObjC.import('AppKit');
  } catch (e) {
    return JSON.stringify({ kind: 'error', message: 'failed to import AppKit: ' + e });
  }

  var stagingDir = argv[0];
  var pb = $.NSPasteboard.generalPasteboard;

  try {
    // Order matters. Finder copies expose file URLs; a browser image copy
    // exposes HTML *and* an image, and must resolve to the image.
    var files = readFileList(pb);
    if (files.length > 0) {
      return JSON.stringify({ kind: 'files', paths: files });
    }

    var staged = stageImage(pb, stagingDir);
    if (staged !== null) {
      return JSON.stringify({ kind: 'image', paths: [staged] });
    }

    return JSON.stringify({ kind: 'other', types: pasteboardTypes(pb) });
  } catch (e) {
    return JSON.stringify({ kind: 'error', message: String(e) });
  }
}

/**
 * Reads file paths from both the modern and the legacy flavour and keeps the
 * longer result.
 *
 * Neither alone is reliable: some apps only declare the legacy
 * NSFilenamesPboardType, and some only put NSURLs on the pasteboard. Taking
 * the longer list covers both without having to know which app copied.
 */
function readFileList(pb) {
  var fromUrls = [];
  try {
    var options = $.NSDictionary.dictionaryWithObjectForKey(
      $.NSNumber.numberWithBool(true),
      $.NSPasteboardURLReadingFileURLsOnlyKey
    );
    var urls = pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL), options);
    if (!isNil(urls)) {
      var count = parseInt(urls.count, 10);
      for (var i = 0; i < count; i++) {
        var url = urls.objectAtIndex(i);
        if (isNil(url) || !url.isFileURL) continue;
        var p = toJsString(url.path);
        if (p !== null) fromUrls.push(p);
      }
    }
  } catch (e) {
    // Leave fromUrls empty; the legacy flavour below may still work.
  }

  var fromLegacy = [];
  try {
    var plist = pb.propertyListForType('NSFilenamesPboardType');
    if (!isNil(plist)) {
      var unwrapped = ObjC.deepUnwrap(plist);
      if (Array.isArray(unwrapped)) {
        for (var j = 0; j < unwrapped.length; j++) {
          if (typeof unwrapped[j] === 'string' && unwrapped[j] !== '')
            fromLegacy.push(unwrapped[j]);
        }
      }
    }
  } catch (e) {
    // Deprecated flavour, absent on modern apps.
  }

  return fromLegacy.length > fromUrls.length ? fromLegacy : fromUrls;
}

/**
 * Writes the pasteboard image to `stagingDir` and returns its path, or null
 * when the pasteboard holds no image.
 *
 * PNG is taken as-is. TIFF is converted, because a macOS screenshot copied
 * with Cmd+Ctrl+Shift+4 often carries only the TIFF flavour.
 */
function stageImage(pb, stagingDir) {
  var png = dataForType(pb, $.NSPasteboardTypePNG);

  if (png === null) {
    var tiff = dataForType(pb, $.NSPasteboardTypeTIFF);
    if (tiff === null) return null;

    var rep = $.NSBitmapImageRep.imageRepWithData(tiff);
    if (isNil(rep)) throw new Error('pasteboard TIFF could not be decoded');

    // 4 == NSBitmapImageFileTypePNG. The named constant is not reliably
    // exposed through the ObjC bridge, the raw value is stable API.
    png = rep.representationUsingTypeProperties(4, $.NSDictionary.dictionary);
    if (isNil(png)) throw new Error('TIFF to PNG conversion produced no data');
  }

  var target = stagingDir + '/clipboard-' + timestamp() + '.png';
  if (!png.writeToFileAtomically($(target), true)) {
    throw new Error('could not write staged image to ' + target);
  }
  return target;
}

function dataForType(pb, type) {
  var data = pb.dataForType(type);
  if (isNil(data) || parseInt(data.length, 10) === 0) return null;
  return data;
}

function pasteboardTypes(pb) {
  try {
    var unwrapped = ObjC.deepUnwrap(pb.types);
    return Array.isArray(unwrapped) ? unwrapped.map(String) : [];
  } catch (e) {
    return [];
  }
}

/** ObjC nil arrives as an object whose isNil() is true; guard undefined too. */
function isNil(value) {
  return (
    value === undefined || value === null || (typeof value.isNil === 'function' && value.isNil())
  );
}

function toJsString(nsString) {
  if (isNil(nsString)) return null;
  var value = ObjC.unwrap(nsString);
  return typeof value === 'string' && value !== '' ? value : null;
}

function timestamp() {
  var d = new Date();
  var p = function (n, width) {
    var s = String(n);
    while (s.length < (width || 2)) s = '0' + s;
    return s;
  };
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    '-' +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds()) +
    '-' +
    p(d.getMilliseconds(), 3)
  );
}
