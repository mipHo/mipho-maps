import type { LatLngLike } from './geo';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function generateGPX(coords: LatLngLike[], elevations: number[], name = 'Walking Route'): string {
  const now = new Date().toISOString();
  const trkpts = coords
    .map((c, i) => {
      const ele = elevations[i] != null ? `\n        <ele>${elevations[i].toFixed(1)}</ele>` : '';
      return `      <trkpt lat="${c.lat.toFixed(7)}" lon="${c.lng.toFixed(7)}">${ele}\n      </trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="maps-mipho">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${now}</time>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

export function generateKML(coords: LatLngLike[], elevations: number[], name = 'Walking Route'): string {
  const coordStr = coords
    .map((c, i) => {
      const ele = elevations[i] != null ? elevations[i].toFixed(1) : '0';
      return `${c.lng.toFixed(7)},${c.lat.toFixed(7)},${ele}`;
    })
    .join(' ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
    <Placemark>
      <name>${escapeXml(name)}</name>
      <Style>
        <LineStyle>
          <color>ffff6633</color>
          <width>4</width>
        </LineStyle>
      </Style>
      <LineString>
        <tessellate>1</tessellate>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>${coordStr}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
