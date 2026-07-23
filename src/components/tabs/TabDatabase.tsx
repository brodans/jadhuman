import React, { useState, useEffect, useMemo } from 'react';
import { Database, Search, Copy, Check, Loader2, X, ChevronDown } from 'lucide-react';
import { simplifiedPegawai, opdList, getPegawaiByNip } from '../../data/database';
import { useAppContext } from '../../context/AppContext';

export default function TabDatabase() {
  const { setLoginForm } = useAppContext();
  const [search, setSearch] = useState('');
  const [selectedOpd, setSelectedOpd] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const [copyMessage, setCopyMessage] = useState('');

  // States for detailed view modal
  const [selectedDetailPegawai, setSelectedDetailPegawai] = useState<any | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // States for OPD custom modal selector
  const [isOpdModalOpen, setIsOpdModalOpen] = useState(false);
  const [opdSearchQuery, setOpdSearchQuery] = useState('');

  const isLoading = false;

  // Debounce the search input to keep typing completely smooth
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setVisibleCount(50);
    }, 200);
    return () => clearTimeout(handler);
  }, [search]);

  // Memoized filtered data using pre-computed simplified list
  const filteredData = useMemo(() => {
    const term = debouncedSearch.toLowerCase().trim();
    if (!term && !selectedOpd) return simplifiedPegawai;
    return simplifiedPegawai.filter((item: any) => {
      const matchesOpd = !selectedOpd || item.instansi === selectedOpd;
      const matchesSearch = !term || (item.nip || '').toLowerCase().includes(term) || (item.nama || '').toLowerCase().includes(term);
      return matchesOpd && matchesSearch;
    });
  }, [debouncedSearch, selectedOpd]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      if (visibleCount < filteredData.length) {
        setVisibleCount(prev => prev + 50);
      }
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setLoginForm({ username: text, password: '' });
      setCopyMessage(`✅ NIP ${text} disalin ke Form Login!`);
      setTimeout(() => {
        setCopiedIndex(null);
        setCopyMessage('');
      }, 4000);
    });
  };

  const handleSelectDetail = (nip: string) => {
    const detail = getPegawaiByNip(nip);
    setSelectedDetailPegawai(detail || null);
  };

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <Database className="w-5 h-5 text-blue-500" /> Database Pegawai
        </h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="relative md:col-span-2">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
            <Search className="w-5 h-5" />
          </span>
          <input 
            type="text" 
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setVisibleCount(50);
            }}
            placeholder="Cari NIP atau Nama Pegawai..." 
            className="w-full pl-10 pr-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm transition-all bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
          />
        </div>
        <div>
          <button
            type="button"
            onClick={() => setIsOpdModalOpen(true)}
            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm transition-all bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm text-left flex justify-between items-center cursor-pointer font-medium"
          >
            <span className="truncate">
              {selectedOpd ? selectedOpd : '-- Semua OPD / Instansi --'}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
          </button>
        </div>
      </div>
      
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm flex flex-col bg-white dark:bg-slate-900">
        <div className="grid grid-cols-[50px_1fr_1.3fr] sm:grid-cols-[80px_200px_1fr] px-1 py-1.5 sm:px-2 sm:py-3 text-[10px] sm:text-sm font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
          <div className="text-center uppercase tracking-wider flex items-center justify-center font-bold text-[9px] sm:text-xs">Aksi</div>
          <div className="px-1.5 sm:px-6 text-left tracking-wider flex items-center uppercase sm:normal-case">NIP</div>
          <div className="px-1.5 sm:px-6 text-left tracking-wider flex items-center">Nama Pegawai</div>
        </div>
        
        <div className="overflow-y-auto max-h-[500px] custom-scrollbar bg-white dark:bg-slate-800" onScroll={handleScroll}>
          {isLoading ? (
            <div className="px-6 py-12 text-center text-slate-500 dark:text-slate-400 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <span className="text-sm font-medium">Memuat data pegawai...</span>
            </div>
          ) : filteredData.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 italic">Data tidak ditemukan.</div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700/50">
              {filteredData.slice(0, visibleCount).map((item: any, index: number) => (
                <div key={index} className="grid grid-cols-[50px_1fr_1.3fr] sm:grid-cols-[80px_200px_1fr] px-1 py-1.5 sm:px-2 sm:py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors items-center text-[10px] sm:text-sm text-slate-700 dark:text-slate-300">
                  <div className="text-center flex justify-center">
                    <button 
                      onClick={() => copyToClipboard(item.nip, index)}
                      className={`p-1 sm:p-1.5 rounded transition-colors ${copiedIndex === index ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                      title="Copy NIP"
                    >
                      {copiedIndex === index ? <Check className="w-3 h-3 sm:w-4 sm:h-4" /> : <Copy className="w-3 h-3 sm:w-4 sm:h-4" />}
                    </button>
                  </div>
                  <div 
                    onClick={() => handleSelectDetail(item.nip)}
                    className="px-1.5 sm:px-6 font-mono font-medium truncate select-all cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    title="Klik untuk detail"
                  >
                    {item.nip}
                  </div>
                  <div 
                    onClick={() => handleSelectDetail(item.nip)}
                    className="px-1.5 sm:px-6 font-medium text-slate-800 dark:text-slate-200 truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    title="Klik untuk detail"
                  >
                    {item.nama}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-between items-center px-2">
        <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{copyMessage}</div>
        <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 ml-auto">Total: {filteredData.length} pegawai</div>
      </div>

      {/* MODAL DETAIL PEGAWAI */}
      {selectedDetailPegawai && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-lg overflow-hidden transform transition-all animate-scale-up flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40 shrink-0">
              <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 text-base">
                <Database className="w-5 h-5 text-indigo-500" /> Detail Pegawai
              </h3>
              <button 
                onClick={() => setSelectedDetailPegawai(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1 text-sm text-slate-700 dark:text-slate-300">
              <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-800/60 space-y-1">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">Nama Lengkap</div>
                <div className="text-base font-bold text-slate-900 dark:text-white leading-tight">{selectedDetailPegawai.nama || '-'}</div>
                <div className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400 mt-1">NIP: {selectedDetailPegawai.nip || '-'}</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-450 dark:text-slate-500">Jabatan</div>
                  <div className="font-semibold text-slate-900 dark:text-white leading-tight">{selectedDetailPegawai.nama_jabatan || selectedDetailPegawai.jabatan || '-'}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-450 dark:text-slate-500">Instansi / OPD</div>
                  <div className="font-semibold text-slate-900 dark:text-white leading-tight">{selectedDetailPegawai.instansi || '-'}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-450 dark:text-slate-500">Unit Kerja (UNOR)</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 leading-tight">{selectedDetailPegawai.unor || '-'}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-450 dark:text-slate-500">Lokasi Kantor</div>
                  <div className="font-semibold text-slate-850 dark:text-slate-200 leading-tight">{selectedDetailPegawai.nama_lokasi || '-'}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-450 dark:text-slate-500">Device ID / Emei</div>
                  <div className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 truncate select-all">{selectedDetailPegawai.emei || selectedDetailPegawai.device_id || '-'}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-450 dark:text-slate-500">No. Rekening</div>
                  <div className="font-semibold text-slate-850 dark:text-slate-200 leading-tight">{selectedDetailPegawai.norekening || '-'}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-450 dark:text-slate-500">Kelas Jabatan</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 leading-tight">{selectedDetailPegawai.kelas_jabatan || '-'}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-450 dark:text-slate-500">Status Kepegawaian</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 leading-tight">{selectedDetailPegawai.status_pegawai || '-'}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-450 dark:text-slate-500">Tipe Jabatan</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 leading-tight">{selectedDetailPegawai.tipe_jabatan || '-'}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-450 dark:text-slate-500">Jam Kerja</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 leading-tight">{selectedDetailPegawai.jam_kerja || '-'}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-450 dark:text-slate-500">ID Pegawai (GUID)</div>
                  <div className="font-mono text-xs text-slate-500 truncate select-all">{selectedDetailPegawai.id || '-'}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-450 dark:text-slate-500">ID Jabatan (GUID)</div>
                  <div className="font-mono text-xs text-slate-500 truncate select-all">{selectedDetailPegawai.id_jabatan || '-'}</div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 shrink-0">
              <button
                onClick={() => {
                  copyToClipboard(selectedDetailPegawai.nip, -1);
                  setSelectedDetailPegawai(null);
                }}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-sm transition-colors cursor-pointer shadow-sm"
              >
                Salin NIP ke Form Login
              </button>
              <button
                onClick={() => setSelectedDetailPegawai(null)}
                className="px-5 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-sm transition-colors cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OPD SEARCH MODAL */}
      {isOpdModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-md overflow-hidden transform transition-all animate-scale-up flex flex-col max-h-[75vh]">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40 shrink-0">
              <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 text-sm uppercase tracking-wider">
                Pilih OPD / Instansi
              </h3>
              <button 
                onClick={() => {
                  setIsOpdModalOpen(false);
                  setOpdSearchQuery('');
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Search Input inside OPD Modal */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0">
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                  <Search className="w-4 h-4" />
                </span>
                <input 
                  type="text" 
                  value={opdSearchQuery}
                  onChange={e => setOpdSearchQuery(e.target.value)}
                  placeholder="Ketik untuk mencari OPD..." 
                  className="w-full pl-9 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-xs font-semibold"
                  autoFocus
                />
              </div>
            </div>

            {/* Scrollable list of OPD options */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 bg-slate-50/50 dark:bg-slate-900/20 divide-y divide-slate-100 dark:divide-slate-700/50">
              {/* Option to clear selection: Semua OPD */}
              <button
                type="button"
                onClick={() => {
                  setSelectedOpd('');
                  setIsOpdModalOpen(false);
                  setOpdSearchQuery('');
                  setVisibleCount(50);
                }}
                className={`w-full text-left px-4 py-3 rounded-xl transition-all text-xs font-bold flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer ${!selectedOpd ? 'text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20' : 'text-slate-700 dark:text-slate-300'}`}
              >
                <span>-- Semua OPD / Instansi --</span>
                {!selectedOpd && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
              </button>

              {/* Filtered OPD options */}
              {opdList
                .filter(opdName => opdName.toLowerCase().includes(opdSearchQuery.toLowerCase()))
                .map((opdName, idx) => {
                  const isSelected = selectedOpd === opdName;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSelectedOpd(opdName);
                        setIsOpdModalOpen(false);
                        setOpdSearchQuery('');
                        setVisibleCount(50);
                      }}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-all text-xs font-bold flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer ${isSelected ? 'text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20' : 'text-slate-700 dark:text-slate-300'}`}
                    >
                      <span className="pr-4">{opdName}</span>
                      {isSelected && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
                    </button>
                  );
                })}
              
              {/* Empty state inside modal */}
              {opdList.filter(opdName => opdName.toLowerCase().includes(opdSearchQuery.toLowerCase())).length === 0 && (
                <div className="p-4 text-center text-xs text-slate-400 italic">OPD tidak ditemukan.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
