export interface PartRef { bbox: [number, number, number, number]; w: number; h: number }

export interface SpecimenManifest {
  id: string;                       // e.g. "n16-1"
  rotate: 'none' | 'cw' | 'ccw';
  plateBox: [number, number, number, number];   // in plate pixels, as printed
  axis: number; bodyHalf: number; wingTop: number;
  bbox: [number, number, number, number];       // in upright specimen pixels
  parts: { body: PartRef | null; 'wing-L': PartRef | null; 'wing-R': PartRef | null;
           'fore-L'?: PartRef | null; 'fore-R'?: PartRef | null; 'hind-L'?: PartRef | null; 'hind-R'?: PartRef | null };
}

export interface PlateManifest {
  plateKey: string; order: number; canvas: [number, number]; paper: [number, number, number];
  source: { flickr: string; bhl: string };
  specimens: SpecimenManifest[];
}

export interface PlateIndexEntry { plateKey: string; order: number; specimens: string[]; rotate: string[] }

export interface SpeciesInfo {
  name?: string; latin?: string; family?: string; wingspan?: string; range?: string; flies?: string;
  facts?: string[]; caption?: string; confidence?: 'confirmed' | 'probable' | 'unread'; figure?: number; role?: string;
}

export interface Content {
  book: { title: string; author?: string; publisher: string; years: string; engraver?: string; bhlItem: string; flickrAlbum?: string; licence?: string };
  plates: Record<string, { order: number; numeral?: string; plate?: string; volume?: number; flickrUrl: string; bhlUrl: string }>;
  specimens: Record<string, SpeciesInfo>;
}
