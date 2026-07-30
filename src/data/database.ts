import { dataPegawai } from './data_pegawai';

// Pre-computed simplified list for TabDatabase
export const simplifiedPegawai = (dataPegawai || []).map((p: any) => ({
  nip: p?.nip || '',
  nama: p?.nama || '',
  instansi: p?.instansi || ''
}));

// Pre-computed unique sorted OPD list
export const opdList = Array.from(
  new Set((dataPegawai || []).map((p: any) => p?.instansi).filter(Boolean))
).sort() as string[];

// Pre-computed simplified list for TabReviewProduktifitas
export const reviewPegawaiList = (dataPegawai || []).map((item: any) => ({
  id: item?.id || item?.id_pegawai || '',
  nip: item?.nip || '',
  nama: item?.nama || '',
  nama_instansi: item?.nama_instansi || item?.unor || item?.nama_unit_kerja || '',
  kode_unor: item?.kode_unor || item?.unor || ''
})).filter((p: any) => p.id && p.nama);

// Pre-computed simplified list for TabReportPegawai
export const reportPegawaiList = (dataPegawai || []).map((item: any) => ({
  id: item?.id || item?.id_pegawai || '',
  nip: item?.nip || '',
  nama: item?.nama || '',
  nama_instansi: item?.nama_instansi || item?.unor || item?.nama_unit_kerja || '',
  nama_unit_kerja: item?.nama_unit_kerja || '',
  kode_unor: item?.kode_unor || item?.unor || ''
})).filter((p: any) => p.id && p.nama);

// Lazy-initialized Map for details lookup by NIP
let pegawaiMap: Map<string, any> | null = null;

export const getPegawaiByNip = (nip: string) => {
  if (!pegawaiMap) {
    pegawaiMap = new Map();
    const list = dataPegawai || [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p && p.nip) {
        pegawaiMap.set(p.nip, p);
      }
    }
  }
  return pegawaiMap.get(nip) || null;
};

export const getPegawaiDatabase = () => {
  return dataPegawai || [];
};

