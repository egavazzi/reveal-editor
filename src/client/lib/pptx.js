import { strToU8, zipSync } from 'fflate'

const xml = (value) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`)
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function pngBytes(dataUrl) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function relationships(items) {
  return xml(`<Relationships xmlns="${REL_NS}">${items.map(({ id, type, target }) =>
    `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`)
}

function shapeTree(extra = '') {
  return `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${extra}</p:spTree>`
}

function slide(width, height) {
  const picture = `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Slide image"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  return xml(`<p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld>${shapeTree(picture)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)
}

function theme() {
  return xml(`<a:theme xmlns:a="${A_NS}" name="reveal-editor"><a:themeElements><a:clrScheme name="reveal-editor"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="3574C4"/></a:accent1><a:accent2><a:srgbClr val="70AD47"/></a:accent2><a:accent3><a:srgbClr val="FFC000"/></a:accent3><a:accent4><a:srgbClr val="5B9BD5"/></a:accent4><a:accent5><a:srgbClr val="ED7D31"/></a:accent5><a:accent6><a:srgbClr val="A5A5A5"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="reveal-editor"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="reveal-editor"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`)
}

function download(bytes, filename) {
  const href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

/** Build a standards-based PPTX whose slides are full-canvas PNG snapshots. */
export function buildPptx(images, canvasWidth, canvasHeight) {
  const width = 9_144_000
  const height = Math.round(width * canvasHeight / canvasWidth)
  const files = {}
  const slideOverrides = images.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
  files['[Content_Types].xml'] = xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${slideOverrides}</Types>`)
  files['_rels/.rels'] = relationships([
    { id: 'rId1', type: `${R_NS}/officeDocument`, target: 'ppt/presentation.xml' },
    { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' },
    { id: 'rId3', type: `${R_NS}/extended-properties`, target: 'docProps/app.xml' }
  ])
  files['docProps/core.xml'] = xml(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>reveal.js presentation</dc:title><dc:creator>reveal-editor</dc:creator><cp:lastModifiedBy>reveal-editor</cp:lastModifiedBy></cp:coreProperties>`)
  files['docProps/app.xml'] = xml(`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>reveal-editor</Application><Slides>${images.length}</Slides><PresentationFormat>Custom</PresentationFormat></Properties>`)
  files['ppt/presentation.xml'] = xml(`<p:presentation xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId${images.length + 1}"/></p:sldMasterIdLst><p:sldIdLst>${images.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${width}" cy="${height}" type="custom"/><p:notesSz cx="${height}" cy="${width}"/></p:presentation>`)
  files['ppt/_rels/presentation.xml.rels'] = relationships([
    ...images.map((_, index) => ({ id: `rId${index + 1}`, type: `${R_NS}/slide`, target: `slides/slide${index + 1}.xml` })),
    { id: `rId${images.length + 1}`, type: `${R_NS}/slideMaster`, target: 'slideMasters/slideMaster1.xml' }
  ])
  files['ppt/slideMasters/slideMaster1.xml'] = xml(`<p:sldMaster xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld name="Blank">${shapeTree()}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`)
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = relationships([
    { id: 'rId1', type: `${R_NS}/slideLayout`, target: '../slideLayouts/slideLayout1.xml' },
    { id: 'rId2', type: `${R_NS}/theme`, target: '../theme/theme1.xml' }
  ])
  files['ppt/slideLayouts/slideLayout1.xml'] = xml(`<p:sldLayout xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}" type="blank" preserve="1"><p:cSld name="Blank">${shapeTree()}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = relationships([{ id: 'rId1', type: `${R_NS}/slideMaster`, target: '../slideMasters/slideMaster1.xml' }])
  files['ppt/theme/theme1.xml'] = theme()
  images.forEach((image, index) => {
    const number = index + 1
    files[`ppt/slides/slide${number}.xml`] = slide(width, height)
    files[`ppt/slides/_rels/slide${number}.xml.rels`] = relationships([
      { id: 'rId1', type: `${R_NS}/image`, target: `../media/image${number}.png` },
      { id: 'rId2', type: `${R_NS}/slideLayout`, target: '../slideLayouts/slideLayout1.xml' }
    ])
    files[`ppt/media/image${number}.png`] = pngBytes(image)
  })
  return zipSync(files, { level: 6 })
}

export function savePptx(images, canvasWidth, canvasHeight, filename) {
  download(buildPptx(images, canvasWidth, canvasHeight), filename)
}
