import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check, Download, Code } from 'lucide-react';

interface DevLogSectionProps {
  title: string;
  filename: string;
  request: any;
  response: any;
}

export default function DevLogSection({ title, filename, request, response }: DevLogSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const formattedLog = `=== API LOG: ${title} ===\n\n[REQUEST PAYLOAD]\n${JSON.stringify(request, null, 2)}\n\n[RESPONSE PAYLOAD]\n${JSON.stringify(response, null, 2)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedLog);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([formattedLog], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900/40 flex items-center justify-between text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-900/60"
      >
        <div className="flex items-center gap-2">
          <Code className="w-4 h-4 text-blue-500" />
          <span className="text-xs font-bold font-mono text-slate-700 dark:text-slate-300 uppercase tracking-wider">{title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 px-1.5 py-0.5 rounded font-mono uppercase">Dev Mode</span>
          {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {isOpen && (
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/20 space-y-3">
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm transition-all hover:bg-slate-50"
              title="Salin Log"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Tersalin' : 'Salin'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm transition-all hover:bg-slate-50"
              title="Download Log (.txt)"
            >
              <Download className="w-3.5 h-3.5 text-blue-500" />
              <span>Download</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 px-1 font-mono">Payload Request:</div>
              <pre className="p-3 text-xs font-mono bg-slate-900 text-slate-300 rounded-xl overflow-x-auto max-h-48 shadow-inner border border-slate-800">
                {JSON.stringify(request, null, 2)}
              </pre>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 px-1 font-mono">Respon JSON:</div>
              <pre className="p-3 text-xs font-mono bg-slate-900 text-slate-300 rounded-xl overflow-x-auto max-h-48 shadow-inner border border-slate-800">
                {JSON.stringify(response, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
