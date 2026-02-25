'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { MapViewport } from '@/lib/map/types';
import { COLORS, SEARCH_CONFIG } from '@/lib/map/config';
import { debounce } from '@/lib/map/utils';

interface SearchResult {
  place_name: string;
  center: [number, number]; // [lng, lat]
  bbox?: [number, number, number, number];
}

interface SearchBarProps {
  onSearch?: (result: SearchResult) => void;
  onFlyTo?: (viewport: Partial<MapViewport>) => void;
  placeholder?: string;
}

export default function SearchBar({
  onSearch,
  onFlyTo,
  placeholder = 'Chercher une adresse...',
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Geocode using Nominatim (free, open-source geocoding)
  const geocode = useCallback(async (q: string) => {
    if (q.length < SEARCH_CONFIG.minChars) {
      setResults([]);
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          q
        )}&countrycodes=fr&limit=${SEARCH_CONFIG.maxResults}`
      );

      if (!response.ok) throw new Error('Geocoding failed');

      const data = await response.json();
      const searchResults: SearchResult[] = data.map((item: any) => ({
        place_name: item.display_name,
        center: [parseFloat(item.lon), parseFloat(item.lat)],
        bbox: item.boundingbox
          ? [
              parseFloat(item.boundingbox[2]),
              parseFloat(item.boundingbox[0]),
              parseFloat(item.boundingbox[3]),
              parseFloat(item.boundingbox[1]),
            ]
          : undefined,
      }));

      setResults(searchResults);
      setIsOpen(true);
    } catch (error) {
      console.error('[SearchBar] Geocoding error:', error);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced search
  const debouncedGeocode = useCallback(
    debounce((q: string) => geocode(q), SEARCH_CONFIG.debounce),
    [geocode]
  );

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    debouncedGeocode(value);
  };

  // Handle result selection
  const handleSelectResult = (result: SearchResult) => {
    setQuery(result.place_name);
    setIsOpen(false);
    setResults([]);

    if (onSearch) {
      onSearch(result);
    }

    if (onFlyTo) {
      onFlyTo({
        longitude: result.center[0],
        latitude: result.center[1],
        zoom: 12,
      });
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        resultsRef.current &&
        !resultsRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative w-full">
      {/* Search Input */}
      <div
        className="flex items-center px-4 py-2 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
        style={{ backgroundColor: COLORS.bg.secondary }}
      >
        <span className="text-slate-400 mr-2">🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none text-white placeholder-slate-500 text-sm"
        />
        {isLoading && (
          <div className="w-4 h-4 border-2 border-slate-600 border-t-accent-blue rounded-full animate-spin" />
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && results.length > 0 && (
        <div
          ref={resultsRef}
          className="absolute top-full left-0 right-0 mt-2 rounded-lg border border-slate-700 overflow-hidden shadow-lg z-50"
          style={{ backgroundColor: COLORS.bg.secondary }}
        >
          {results.map((result, index) => (
            <button
              key={index}
              onClick={() => handleSelectResult(result)}
              className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-slate-700 transition-colors border-b border-slate-700 last:border-b-0"
            >
              <p className="font-medium text-white line-clamp-1">
                {result.place_name}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* No Results Message */}
      {isOpen && query.length >= SEARCH_CONFIG.minChars && results.length === 0 && !isLoading && (
        <div
          className="absolute top-full left-0 right-0 mt-2 rounded-lg border border-slate-700 p-4 text-center text-sm text-slate-400"
          style={{ backgroundColor: COLORS.bg.secondary }}
        >
          Aucun résultat trouvé
        </div>
      )}
    </div>
  );
}
