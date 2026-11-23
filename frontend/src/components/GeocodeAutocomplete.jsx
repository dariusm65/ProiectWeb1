import React, { useEffect, useRef, useState } from 'react';
import { geocodingApi } from '../api/client.js';
import { KNOWN_SURVEY_PLACES } from '../domain/bucharestTime.js';
import { useAuth } from '../context/AuthContext.jsx';

export function GeocodeAutocomplete({
  id,
  label,
  value,
  onChange,
  onSelectPlace,
  placeholder = 'Ex: Sibiu, Cluj-Napoca, Bacău',
  debounceMs = 450,
}) {
  const { fetchFn } = useAuth();
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const lastSelectedRef = useRef(value);
  const containerRef = useRef(null);
  const listboxId = `${id}-listbox`;

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    const query = String(value || '').trim();
    if (!open || query.length < 2 || query === lastSelectedRef.current) {
      setSuggestions([]);
      setLoading(false);
      return undefined;
    }

    const localMatches = KNOWN_SURVEY_PLACES.filter(
      (p) =>
        p.city_name.toLowerCase().includes(query.toLowerCase()) ||
        p.location_name.toLowerCase().includes(query.toLowerCase()),
    ).slice(0, 4);

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const remote = await geocodingApi.search(query, {
          signal: controller.signal,
          fetchFn,
        });
        if (controller.signal.aborted) return;
        const merged = [...localMatches];
        if (remote && Number.isFinite(remote.lat) && Number.isFinite(remote.lng)) {
          const primaryCity = String(remote.display_name || query).split(',')[0].trim();
          merged.unshift({
            city_name: primaryCity || query,
            location_name: remote.display_name || query,
            latitude: Number(remote.lat),
            longitude: Number(remote.lng),
            source: remote.source || 'nominatim',
          });
        }
        setSuggestions(merged);
      } catch {
        if (controller.signal.aborted) return;
        setSuggestions(localMatches);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, open, debounceMs, fetchFn]);

  const handleChoose = (place) => {
    const labelText = `${place.city_name} (${place.location_name})`;
    lastSelectedRef.current = labelText;
    onChange(labelText);
    if (onSelectPlace) {
      onSelectPlace(place);
    }
    setOpen(false);
    setSuggestions([]);
  };

  const isExpanded = Boolean(open && suggestions.length > 0);

  return (
    <div className="field" ref={containerRef}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        className="input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isExpanded}
        aria-controls={listboxId}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        onChange={(e) => {
          setOpen(true);
          onChange(e.target.value);
        }}
      />
      {loading && (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          Se caută localitatea...
        </span>
      )}
      {isExpanded && (
        <ul
          id={listboxId}
          className="autocomplete-menu"
          role="listbox"
          aria-label={`Sugestii pentru ${label}`}
        >
          {suggestions.map((place, idx) => (
            <li
              key={`${place.city_name}-${place.latitude}-${idx}`}
              role="option"
              aria-selected={false}
            >
              <button
                type="button"
                className="autocomplete-option"
                onClick={() => handleChoose(place)}
              >
                <strong>{place.city_name}</strong> · {place.location_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
