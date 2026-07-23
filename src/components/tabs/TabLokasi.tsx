import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Map, MapPin, Search, X, ChevronDown, Check, Layers, ExternalLink } from 'lucide-react';
import { dataLokasi } from '../../data/data_lokasi';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Separate Leaflet map component to guarantee proper mounting and rendering inside the modal
function MapView({ 
  latitude, 
  longitude, 
  radius, 
  nama, 
  alamat 
}: { 
  latitude: number; 
  longitude: number; 
  radius: number; 
  nama: string; 
  alamat?: string | null; 
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  
  const [tileType, setTileType] = useState<'hybrid' | 'roadmap' | 'satellite'>('hybrid');
  const [showTilesMenu, setShowTilesMenu] = useState(false);

  const tileUrls = {
    hybrid: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    roadmap: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    satellite: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  };

  useEffect(() => {
    if (!containerRef.current) return;

    // Check if map is already initialized, if so, clean it up
    if (mapRef.current) {
      mapRef.current.remove();
    }

    // Initialize Leaflet Map
    const map = L.map(containerRef.current, {
      center: [latitude, longitude],
      zoom: 16,
      zoomControl: true,
      fadeAnimation: true,
    });
    mapRef.current = map;

    // Add Google Tile Layer based on tileType state
    const tileLayer = L.tileLayer(tileUrls[tileType], {
      attribution: '&copy; Google Maps',
      maxZoom: 21,
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    // Create customized pulsing modern SVG Marker Pin
    const customIcon = L.divIcon({
      html: `
        <div class="relative flex items-center justify-center">
          <span class="absolute inline-flex h-10 w-10 rounded-full bg-red-400/50 opacity-75 animate-ping"></span>
          <span class="relative inline-flex rounded-full h-6 w-6 bg-red-600 border-2 border-white shadow-lg items-center justify-center">
            <span class="h-2 w-2 rounded-full bg-white"></span>
          </span>
        </div>
      `,
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    // Place Marker
    const marker = L.marker([latitude, longitude], { icon: customIcon }).addTo(map);
    marker.bindPopup(`
      <div class="p-1 font-sans text-xs text-slate-800 dark:text-slate-100">
        <h4 class="font-bold text-sm text-slate-900 mb-1">${nama}</h4>
        <p class="text-slate-500 mb-1">${alamat || 'Tidak ada alamat lengkap'}</p>
        <p class="font-semibold text-blue-600 dark:text-blue-400">Koordinat: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</p>
        <p class="font-bold text-emerald-600 dark:text-emerald-400">Radius: ${radius} meter</p>
      </div>
    `, {
      maxWidth: 260
    }).openPopup();
    markerRef.current = marker;

    // Draw the accurate, precise radius circle
    const circle = L.circle([latitude, longitude], {
      color: '#ef4444',      // Red border to match marker
      fillColor: '#ef4444',  // Red fill
      fillOpacity: 0.15,
      radius: radius,
      weight: 2,
    }).addTo(map);
    circleRef.current = circle;

    // Zoom the map to perfectly fit the Circle Bounds
    const bounds = circle.getBounds();
    map.fitBounds(bounds, { padding: [40, 40] });

    // Instantly invalidate size in a minor delay to avoid incomplete rendering in flex modals
    const resizeTimer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      clearTimeout(resizeTimer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [latitude, longitude, radius, nama, alamat]);

  // Dynamically swap the tiles upon user selection without full rebuild
  useEffect(() => {
    if (tileLayerRef.current) {
      tileLayerRef.current.setUrl(tileUrls[tileType]);
    }
  }, [tileType]);

  return (
    <div className="relative w-full h-full flex flex-col flex-1 min-h-[420px] md:min-h-[480px]">
      {/* Tile Layers Control Overlay (Compact togglable dropdown) */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col items-end gap-1.5">
        <button
          onClick={() => setShowTilesMenu(!showTilesMenu)}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/95 dark:bg-slate-800/95 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl shadow-lg border border-slate-200/80 dark:border-slate-700/80 transition-all text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
          title="Ubah Tipe Peta"
        >
          <Layers className="w-3.5 h-3.5 text-blue-500" />
          <span>Tipe Peta</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showTilesMenu ? 'rotate-180' : ''}`} />
        </button>

        {showTilesMenu && (
          <div className="bg-white/95 dark:bg-slate-800/95 p-1 rounded-xl shadow-2xl border border-slate-200/80 dark:border-slate-700/80 flex flex-col gap-0.5 min-w-[130px] animate-scale-up">
            {(['hybrid', 'roadmap', 'satellite'] as const).map((type) => (
              <button
                key={type}
                onClick={() => {
                  setTileType(type);
                  setShowTilesMenu(false);
                }}
                className={`px-3 py-2 rounded-lg text-left text-xs font-bold transition-all cursor-pointer flex items-center justify-between ${
                  tileType === type
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <span>
                  {type === 'hybrid' ? 'Hibrida' : type === 'roadmap' ? 'Peta Jalan' : 'Satelit'}
                </span>
                {tileType === type && <Check className="w-3.5 h-3.5 text-white" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Actual Map Container */}
      <div ref={containerRef} className="w-full h-full flex-1 rounded-xl overflow-hidden shadow-inner border border-slate-200 dark:border-slate-700" />
    </div>
  );
}

export default function TabLokasi() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);

  // Selected Location for Map Modal
  const [selectedMapLocation, setSelectedMapLocation] = useState<any | null>(null);

  // Debounce search input to maintain fluid performance with 24k+ data points
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setVisibleCount(50); // Reset page size on search change
    }, 250);
    return () => clearTimeout(handler);
  }, [search]);

  // Filter coordinates based on search criteria
  const filteredData = useMemo(() => {
    const term = debouncedSearch.toLowerCase().trim();
    if (!term) return dataLokasi;

    return dataLokasi.filter(item => {
      return (
        (item.kode || '').toLowerCase().includes(term) ||
        (item.nama || '').toLowerCase().includes(term) ||
        (item.alamat || '').toLowerCase().includes(term) ||
        (item.kota?.nama || '').toLowerCase().includes(term) ||
        (item.kota?.propinsi?.nama || '').toLowerCase().includes(term)
      );
    });
  }, [debouncedSearch]);

  // Infinite scroll loader
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 80) {
      if (visibleCount < filteredData.length) {
        setVisibleCount(prev => prev + 50);
      }
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <Map className="w-5 h-5 text-blue-500" /> Data Lokasi Kantor / Instansi
        </h3>
      </div>

      {/* Search and Filters */}
      <div className="w-full">
        <div className="relative w-full">
          <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
            <Search className="w-5 h-5" />
          </span>
          <input 
            type="text" 
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setVisibleCount(50);
            }}
            placeholder="Cari nama lokasi, kode, alamat, atau kota..." 
            className="w-full pl-11 pr-10 py-3 border border-slate-300 dark:border-slate-650 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm transition-all bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:bg-white dark:focus:bg-slate-900/40"
          />
          {search && (
            <button 
              onClick={() => { setSearch(''); setVisibleCount(50); }}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Table Section */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm flex flex-col bg-white dark:bg-slate-900">
        <div className="grid grid-cols-[1fr_80px] sm:grid-cols-[100px_1fr_1.5fr_100px_90px] px-2 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 uppercase tracking-wider">
          <div className="hidden sm:block px-4">Kode</div>
          <div className="px-2 sm:px-4">Nama Lokasi</div>
          <div className="hidden sm:block px-4">Alamat & Kota</div>
          <div className="hidden sm:block px-4 text-right">Radius</div>
          <div className="text-center">Aksi</div>
        </div>

        <div 
          className="overflow-y-auto max-h-[500px] custom-scrollbar bg-white dark:bg-slate-850 divide-y divide-slate-100 dark:divide-slate-700/50" 
          onScroll={handleScroll}
        >
          {filteredData.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500 dark:text-slate-400 italic">
              Data lokasi tidak ditemukan. Coba bersihkan atau ubah kata kunci pencarian.
            </div>
          ) : (
            filteredData.slice(0, visibleCount).map((item) => (
              <div 
                key={item.id} 
                className="grid grid-cols-[1fr_80px] sm:grid-cols-[100px_1fr_1.5fr_100px_90px] px-2 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors items-center text-xs sm:text-sm text-slate-700 dark:text-slate-300"
              >
                {/* Kode */}
                <div className="hidden sm:block px-4 font-mono font-medium text-slate-500 dark:text-slate-400">
                  {item.kode || '-'}
                </div>

                {/* Nama Lokasi */}
                <div className="px-2 sm:px-4 font-semibold text-slate-900 dark:text-white leading-snug">
                  <div>{item.nama}</div>
                  <div className="block sm:hidden text-[10px] font-mono text-slate-400 mt-0.5">
                    Kode: {item.kode} • Radius: {item.radius}m
                  </div>
                </div>

                {/* Alamat & Kota */}
                <div className="hidden sm:block px-4 text-xs text-slate-600 dark:text-slate-400 leading-normal">
                  <div className="truncate font-medium max-w-[280px]" title={item.alamat || ''}>
                    {item.alamat || '-'}
                  </div>
                  {item.kota && (
                    <div className="text-[10px] text-slate-400 mt-0.5 font-semibold">
                      {item.kota.nama}, {item.kota.propinsi?.nama || 'JAWA TIMUR'}
                    </div>
                  )}
                </div>

                {/* Radius */}
                <div className="hidden sm:block px-4 text-right font-semibold text-emerald-600 dark:text-emerald-400 font-mono">
                  {item.radius}m
                </div>

                {/* Action Maps Button */}
                <div className="text-center flex items-center justify-center">
                  <button
                    onClick={() => setSelectedMapLocation(item)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold transition-all text-xs cursor-pointer shadow-sm hover:scale-[1.03]"
                    title="Buka Peta Leaflet Google Satelit"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Peta</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer statistics info */}
      <div className="flex flex-col sm:flex-row justify-between items-center px-1 text-xs font-semibold text-slate-500 dark:text-slate-400 gap-2">
        <div>
          Menampilkan {Math.min(visibleCount, filteredData.length)} dari {filteredData.length} lokasi
        </div>
        <div>
          Total Database: {dataLokasi.length} Lokasi
        </div>
      </div>



      {/* 2. LEAFLET MAP MODAL POPUP */}
      {selectedMapLocation && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-4xl overflow-hidden transform transition-all animate-scale-up flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <MapPin className="w-5 h-5 animate-bounce" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-white text-sm md:text-base leading-tight">
                    {selectedMapLocation.nama}
                  </h3>
                  <p className="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 font-medium">
                    Kode: {selectedMapLocation.kode} • Radius Presisi: {selectedMapLocation.radius} meter
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedMapLocation(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer bg-slate-100 dark:bg-slate-700 p-2 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Interactive Map Display */}
            <div className="p-4 bg-slate-50 dark:bg-slate-900 flex-1 flex flex-col min-h-0 overflow-y-auto">
              <MapView 
                latitude={selectedMapLocation.latitude} 
                longitude={selectedMapLocation.longitude} 
                radius={selectedMapLocation.radius}
                nama={selectedMapLocation.nama}
                alamat={selectedMapLocation.alamat}
              />
            </div>

            {/* Footer with Metadata */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 shrink-0 text-xs text-slate-600 dark:text-slate-400">
              <div className="space-y-0.5 text-center sm:text-left">
                <p className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[400px]">
                  Alamat: {selectedMapLocation.alamat || '-'}
                </p>
                {selectedMapLocation.kota && (
                  <p className="font-medium text-slate-500">
                    Daerah: {selectedMapLocation.kota.nama}, {selectedMapLocation.kota.propinsi?.nama || 'JAWA TIMUR'}
                  </p>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${selectedMapLocation.latitude},${selectedMapLocation.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all cursor-pointer shadow-sm text-sm text-center flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Lihat di Google Maps</span>
                </a>
                <button
                  onClick={() => setSelectedMapLocation(null)}
                  className="w-full sm:w-auto px-5 py-2.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-150 font-bold rounded-xl transition-all cursor-pointer shadow-sm text-sm"
                >
                  Tutup Peta
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
