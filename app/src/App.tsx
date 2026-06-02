import { useState, FormEvent, useRef, ChangeEvent, useEffect } from 'react';
import { analyzeImage, type AnalysisResult } from './services/geminiService';
import * as XLSX from 'xlsx';
import { 
  Search, 
  Image as ImageIcon, 
  CheckCircle2, 
  XCircle, 
  Info, 
  Loader2, 
  Camera, 
  User,
  ChevronRight,
  AlertCircle,
  Upload,
  Download,
  FileText,
  X,
  History,
  LayoutDashboard,
  Trash2,
  Calendar,
  Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface HistoricalSession {
  id: string;
  date: string;
  name: string;
  summary: {
    total: number;
    withModel: number;
    success: number;
  };
  results: {
    name: string;
    hasModel: boolean;
    isMainProductShot: boolean;
    confidence: number;
    columnName?: string;
  }[];
}

export default function App() {
  const [view, setView] = useState<'analyzer' | 'history'>('analyzer');
  const [imageUrl, setImageUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [singleHistory, setSingleHistory] = useState<{url: string, result: AnalysisResult}[]>([]);
  
  // Batch states
  const [batchMode, setBatchMode] = useState(false);
  const [batchResults, setBatchResults] = useState<{file?: File, url?: string, name: string, result: AnalysisResult | null, status: 'pending' | 'processing' | 'done' | 'error', originalRow?: any, originalRowIndex?: number, columnName?: string}[]>([]);
  
  // Persistent History
  const [fullHistory, setFullHistory] = useState<HistoricalSession[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('modelshot_history');
    if (saved) {
      try {
        setFullHistory(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load history');
      }
    }
  }, []);

  const saveToHistory = (results: any[]) => {
    if (results.length === 0 || !results.some(r => r.status === 'done')) return;

    const session: HistoricalSession = {
      id: Date.now().toString(),
      date: new Date().toLocaleString(),
      name: results[0].file?.name || '批量 Excel 链接分析',
      summary: {
        total: results.length,
        withModel: results.filter(r => r.result?.hasModel).length,
        success: results.filter(r => r.status === 'done').length
      },
      results: results.map(r => ({
        name: r.name,
        hasModel: !!r.result?.hasModel,
        isMainProductShot: !!r.result?.isMainProductShot,
        confidence: r.result?.confidence || 0,
        columnName: r.columnName
      }))
    };

    const updated = [session, ...fullHistory].slice(0, 50);
    setFullHistory(updated);
    localStorage.setItem('modelshot_history', JSON.stringify(updated));
  };

  const deleteHistoryItem = (id: string) => {
    const updated = fullHistory.filter(h => h.id !== id);
    setFullHistory(updated);
    localStorage.setItem('modelshot_history', JSON.stringify(updated));
  };
  const [excelColumns, setExcelColumns] = useState<string[]>([]);
  const [selectedUrlColumns, setSelectedUrlColumns] = useState<string[]>([]);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [pendingExcelData, setPendingExcelData] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const allFiles = Array.from(e.target.files) as File[];
      const imageFiles = allFiles.filter(f => f.type.startsWith('image/'));
      const excelFiles = allFiles.filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv'));

      if (imageFiles.length > 0) {
        setBatchResults(prev => [
          ...prev,
          ...imageFiles.map(f => ({ file: f, name: f.name, result: null, status: 'pending' as const }))
        ]);
      }

      if (excelFiles.length > 0) {
        handleExcelUpload(excelFiles[0]);
      }
    }
  };

  const handleExcelUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      const workbook = XLSX.read(data, { type: 'binary' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length > 0) {
        const columns = Object.keys(jsonData[0] as object);
        setExcelColumns(columns);
        setPendingExcelData(jsonData);
        setShowColumnPicker(true);
      }
    };
    reader.readAsBinaryString(file);
  };

  const toggleColumn = (col: string) => {
    setSelectedUrlColumns(prev => 
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const confirmExcelLinks = () => {
    const batchItems: any[] = [];
    
    pendingExcelData.forEach((row, rowIndex) => {
      selectedUrlColumns.forEach(columnName => {
        const link = row[columnName];
        if (typeof link === 'string' && (link.startsWith('http') || link.startsWith('https'))) {
          batchItems.push({
            url: link,
            name: `${columnName} (第${rowIndex + 1}行)`,
            result: null,
            status: 'pending' as const,
            originalRowIndex: rowIndex,
            columnName,
            originalRow: row
          });
        }
      });
    });

    if (batchItems.length > 0) {
      setBatchResults(prev => [...prev, ...batchItems]);
    } else {
      setError('所选列中未找到有效的图片链接');
    }
    setShowColumnPicker(false);
    setSelectedUrlColumns([]);
  };

  const removeBatchItem = (index: number) => {
    setBatchResults(prev => prev.filter((_, i) => i !== index));
  };

  const runBatchAnalysis = async () => {
    setAnalyzing(true);
    const newResults = [...batchResults];
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    for (let i = 0; i < newResults.length; i++) {
      if (newResults[i].status === 'done') continue;
      
      newResults[i].status = 'processing';
      setBatchResults([...newResults]);
      
      try {
        const source = newResults[i].file || newResults[i].url!;
        const data = await analyzeImage(source);
        newResults[i].result = data;
        newResults[i].status = 'done';
        
        // 成功后等待 2 秒再进行下一个，以防触发 RPM 限制
        if (i < newResults.length - 1 && newResults.some((item, idx) => idx > i && item.status !== 'done')) {
          await sleep(2000);
        }
      } catch (err: any) {
        console.error(err);
        newResults[i].status = 'error';
        const errorMsg = err.message || '';
        if (errorMsg.toLowerCase().includes('quota') || errorMsg.includes('429')) {
          setError('API 请求频率过快或配额已满。系统已暂停，请 1 分钟后重试。');
          setBatchResults([...newResults]);
          setAnalyzing(false);
          return; // 遇到配额限制直接停止，防止死循环报错
        }
      }
      setBatchResults([...newResults]);
    }
    setAnalyzing(false);
    saveToHistory(newResults);
  };

  const exportToExcel = () => {
    let finalData: any[] = [];

    if (pendingExcelData.length > 0) {
      // Group batch results by their original row index
      const groupedResults: Record<number, Record<string, AnalysisResult | null>> = {};
      
      batchResults.forEach(item => {
        if (item.originalRowIndex !== undefined && item.columnName) {
          if (!groupedResults[item.originalRowIndex]) {
            groupedResults[item.originalRowIndex] = {};
          }
          groupedResults[item.originalRowIndex][item.columnName] = item.result;
        }
      });

      // Map rows to original structure + new AI result columns
      finalData = pendingExcelData.map((originalRow, rowIndex) => {
        const rowResults = groupedResults[rowIndex];
        const newRow: any = {};
        
        // Find keys corresponding to 1:1 and 3:4
        let key1_1: string | undefined;
        let key3_4: string | undefined;

        Object.keys(originalRow).forEach(key => {
          const cleanKey = key.replace(/\s+/g, '');
          if (cleanKey.includes("1:1") || cleanKey.includes("1：1")) {
            key1_1 = key;
          }
          if (cleanKey.includes("3:4") || cleanKey.includes("3：4")) {
            key3_4 = key;
          }
        });

        // Determine combined value: TRUE if both are model shots, FALSE if at least one is not (or if one of them has been analyzed and is false), empty if state is not clear yet
        let combinedVal = '';
        if (key1_1 && key3_4) {
          const res1 = rowResults?.[key1_1];
          const res3 = rowResults?.[key3_4];
          
          const isModel1 = res1 ? res1.isMainProductShot : null;
          const isModel3 = res3 ? res3.isMainProductShot : null;
          
          if (res1 && res3) {
            if (isModel1 && isModel3) {
              combinedVal = 'TRUE';
            } else {
              combinedVal = 'FALSE';
            }
          } else {
            // If one of them has finished and is FALSE, we can flag FALSE early
            if (isModel1 === false || isModel3 === false) {
              combinedVal = 'FALSE';
            } else {
              combinedVal = '';
            }
          }
        }

        // Get the list of keys that were analyzed in this row
        const analyzedKeys = Object.keys(originalRow).filter(key => rowResults && rowResults[key] !== undefined);
        const lastAnalyzedKey = analyzedKeys[analyzedKeys.length - 1];

        // 遍历原始字段，并在分析过的字段后紧跟插入结果列
        Object.keys(originalRow).forEach(key => {
          newRow[key] = originalRow[key];
          
          // 如果该列是被分析的图片列，则在其后添加结果
          if (rowResults && rowResults[key] !== undefined) {
            const result = rowResults[key];
            newRow[`${key}_是否模拍主图`] = result ? (result.isMainProductShot ? 'TRUE' : 'FALSE') : '';
          }

          // 如果当前列是最后一个被分析的列，且检测到了1:1和3:4类目的主图，在其后紧跟着追加综合判定结果列
          if (key === lastAnalyzedKey && key1_1 && key3_4) {
            newRow['1:1与3:4主图是否均为模拍主图'] = combinedVal;
          }
        });

        // 兜底保障：如果未能成功添加且表格里确实包含这两列，追加在行最后
        if (key1_1 && key3_4 && newRow['1:1与3:4主图是否均为模拍主图'] === undefined) {
          newRow['1:1与3:4主图是否均为模拍主图'] = combinedVal;
        }

        return newRow;
      });
    } else {
      // Fallback for direct image uploads
      finalData = batchResults.map(item => ({
        '文件名/链接': item.name || item.url,
        '是否模拍主图': item.result ? (item.result.isMainProductShot ? 'TRUE' : 'FALSE') : '-',
        '置信度': item.result ? `${(item.result.confidence * 100).toFixed(0)}%` : '-',
        '原始链接': item.url || '-',
        '状态': item.status === 'done' ? '成功' : item.status === 'error' ? '失败' : '待处理'
      }));
    }

    const worksheet = XLSX.utils.json_to_sheet(finalData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "批量分析结果");
    XLSX.writeFile(workbook, `分析结果_${new Date().getTime()}.xlsx`);
  };

  const handleAnalyze = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!imageUrl) return;

    setAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const data = await analyzeImage(imageUrl);
      setResult(data);
      setSingleHistory(prev => [{ url: imageUrl, result: data }, ...prev].slice(0, 5));
    } catch (err: any) {
      console.error(err);
      const errorMsg = err.message || '';
      if (errorMsg.toLowerCase().includes('quota') || errorMsg.includes('429')) {
        setError('API 配额已达上限。请稍等片刻或明天再试。');
      } else {
        setError(errorMsg || '分析失败，请检查链接是否正确且允许访问');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] font-sans text-[#1A1A1A] selection:bg-[#E0E0E0]">
      {/* Header */}
      <header className="border-b border-[#E0E0E0] bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">ModelShot AI</h1>
          </div>
          
          <nav className="flex items-center bg-[#F5F5F5] p-1 rounded-xl">
            <button 
              onClick={() => setView('analyzer')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'analyzer' ? 'bg-white shadow-sm text-black' : 'text-[#757575] hover:text-black'}`}
            >
              <LayoutDashboard className="w-4 h-4" />
              工作台
            </button>
            <button 
              onClick={() => setView('history')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'history' ? 'bg-white shadow-sm text-black' : 'text-[#757575] hover:text-black'}`}
            >
              <History className="w-4 h-4" />
              历史文件
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {view === 'analyzer' ? (
            <motion.div 
              key="analyzer-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Mode Toggle */}
        <div className="max-w-2xl mx-auto mb-8 flex p-1 bg-[#E0E0E0] rounded-xl overflow-hidden">
          <button 
            onClick={() => setBatchMode(false)}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${!batchMode ? 'bg-white shadow-sm text-black' : 'text-[#757575] hover:text-black'}`}
          >
            单图链接分析
          </button>
          <button 
            onClick={() => setBatchMode(true)}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${batchMode ? 'bg-white shadow-sm text-black' : 'text-[#757575] hover:text-black'}`}
          >
            批量文件分析
          </button>
        </div>

        {/* Input Section */}
        <section className="mb-12">
          <div className="max-w-2xl mx-auto">
            {!batchMode ? (
              <>
                <h2 className="text-center text-3xl font-light mb-8 text-[#1A1A1A]">
                  分析图片链接，智能识别模特与主图
                </h2>
                <form onSubmit={handleAnalyze} className="relative group">
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="在此输入图片链接 (URL)..."
                    className="w-full h-14 pl-12 pr-32 bg-white border border-[#E0E0E0] rounded-2xl shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black transition-all text-base placeholder:text-[#9E9E9E]"
                  />
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9E9E9E] group-focus-within:text-black transition-colors" />
                  <button
                    type="submit"
                    disabled={analyzing || !imageUrl}
                    className="absolute right-2 top-2 bottom-2 px-6 bg-black text-white rounded-xl font-medium text-sm hover:bg-[#333] disabled:bg-[#E0E0E0] disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                  >
                    {analyzing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>分析中...</span>
                      </>
                    ) : (
                      <>
                        <span>立即分析</span>
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
                <p className="mt-4 text-center text-xs text-[#757575] flex items-center justify-center gap-2 text-balance">
                  <Info className="w-3 h-3" />
                  支持足部、腹部等局部特写识别。
                </p>
              </>
            ) : (
              <div className="space-y-6">
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files) {
                      const allFiles = Array.from(e.dataTransfer.files) as File[];
                      const imageFiles = allFiles.filter(f => f.type.startsWith('image/'));
                      const excelFiles = allFiles.filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv'));

                      if (imageFiles.length > 0) {
                        setBatchResults(prev => [
                          ...prev,
                          ...imageFiles.map(f => ({ file: f, name: f.name, result: null, status: 'pending' as const }))
                        ]);
                      }

                      if (excelFiles.length > 0) {
                        handleExcelUpload(excelFiles[0]);
                      }
                    }
                  }}
                  className="border-2 border-dashed border-[#E0E0E0] hover:border-black rounded-3xl p-12 text-center transition-all cursor-pointer bg-white group"
                >
                  <input 
                    type="file" 
                    multiple 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*,.xlsx,.xls,.csv"
                    onChange={handleFileSelect}
                  />
                  <Upload className="w-12 h-12 mx-auto mb-4 text-[#9E9E9E] group-hover:text-black transition-colors" />
                  <p className="text-lg font-medium text-[#1A1A1A]">拖拽或点击上传文件</p>
                  <p className="text-sm text-[#757575] mt-1">支持批量图片或 Excel 链接列表</p>
                </div>

                <AnimatePresence>
                  {showColumnPicker && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-[#E0F2FE] border border-[#7DD3FC] p-6 rounded-2xl"
                    >
                      <h4 className="text-sm font-bold text-[#0369A1] mb-4 flex items-center gap-2 uppercase tracking-wider">
                        <AlertCircle className="w-4 h-4" />
                        请选择包含图片链接的列
                      </h4>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {excelColumns.map(col => (
                          <button
                            key={col}
                            onClick={() => toggleColumn(col)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${selectedUrlColumns.includes(col) ? 'bg-[#0369A1] text-white border-[#0369A1]' : 'bg-white text-[#0369A1] border-[#7DD3FC] hover:bg-[#F0F9FF]'}`}
                          >
                            {col}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={confirmExcelLinks}
                          disabled={selectedUrlColumns.length === 0}
                          className="px-6 py-2 bg-[#0369A1] text-white rounded-xl text-sm font-bold hover:bg-[#075985] disabled:opacity-50 transition-all"
                        >
                          确认导入所选列
                        </button>
                        <button
                          onClick={() => {
                            setShowColumnPicker(false);
                            setSelectedUrlColumns([]);
                          }}
                          className="px-6 py-2 bg-white text-[#0369A1] border border-[#7DD3FC] rounded-xl text-sm font-bold hover:bg-[#F0F9FF] transition-all"
                        >
                          取消
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {batchResults.length > 0 && (
                  <div className="space-y-6">
                    {/* 进度条与总结面板 */}
                    <div className="bg-white rounded-3xl border border-[#E0E0E0] p-6 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-sm font-bold text-[#1A1A1A] uppercase tracking-wider flex items-center gap-2">
                            <Layers className="w-4 h-4" />
                            分析任务看板
                          </h3>
                        </div>
                        <div className="text-right">
                          <span className="text-2xl font-light">
                            {Math.round((batchResults.filter(r => r.status === 'done' || r.status === 'error').length / batchResults.length) * 100)}%
                          </span>
                        </div>
                      </div>
                      
                      {/* 进度条 */}
                      <div className="w-full h-2 bg-[#F5F5F5] rounded-full overflow-hidden mb-6">
                        <motion.div 
                          className="h-full bg-black"
                          initial={{ width: 0 }}
                          animate={{ 
                            width: `${(batchResults.filter(r => r.status === 'done' || r.status === 'error').length / batchResults.length) * 100}%` 
                          }}
                        />
                      </div>

                      {/* 总结统计 */}
                      <div className="grid grid-cols-4 gap-4">
                        <div className="p-4 bg-[#F9F9F9] rounded-2xl border border-[#F0F0F0]">
                          <p className="text-[10px] font-bold text-[#9E9E9E] uppercase tracking-widest mb-1">总任务</p>
                          <p className="text-xl font-medium">{batchResults.length}</p>
                        </div>
                        <div className="p-4 bg-[#ECFDF5] rounded-2xl border border-[#D1FAE5]">
                          <p className="text-[10px] font-bold text-[#059669] uppercase tracking-widest mb-1">是模拍</p>
                          <p className="text-xl font-medium text-[#059669]">
                            {batchResults.filter(r => r.result?.isMainProductShot).length}
                          </p>
                        </div>
                        <div className="p-4 bg-[#FFF7ED] rounded-2xl border border-[#FFEDD5]">
                          <p className="text-[10px] font-bold text-[#D97706] uppercase tracking-widest mb-1">非模拍</p>
                          <p className="text-xl font-medium text-[#D97706]">
                            {batchResults.filter(r => r.status === 'done' && !r.result?.isMainProductShot).length}
                          </p>
                        </div>
                        <div className="p-4 bg-[#FEF2F2] rounded-2xl border border-[#FEE2E2]">
                          <p className="text-[10px] font-bold text-[#DC2626] uppercase tracking-widest mb-1">失败</p>
                          <p className="text-xl font-medium text-[#DC2626]">
                            {batchResults.filter(r => r.status === 'error').length}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-3xl border border-[#E0E0E0] overflow-hidden">
                    <div className="p-4 border-b border-[#E0E0E0] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-[#757575]" />
                        <span className="text-sm font-semibold">待分析队列 ({batchResults.length})</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={runBatchAnalysis}
                          disabled={analyzing}
                          className="px-4 py-1.5 bg-black text-white rounded-lg text-xs font-medium hover:bg-[#333] transition-colors disabled:opacity-50"
                        >
                          {analyzing ? '分析中...' : '开始批量分析'}
                        </button>
                        <button
                          onClick={exportToExcel}
                          disabled={!batchResults.some(r => r.status === 'done')}
                          className="px-4 py-1.5 bg-[#F5F5F5] border border-[#E0E0E0] text-black rounded-lg text-xs font-medium hover:bg-[#E0E0E0] transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          导出 Excel
                        </button>
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {batchResults.map((item, idx) => (
                        <div key={idx} className="p-4 border-b border-[#F5F5F5] last:border-b-0 flex items-center justify-between group">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="w-10 h-10 bg-[#F9F9F9] rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                               {item.file ? (
                                 <img src={URL.createObjectURL(item.file)} className="w-full h-full object-cover" />
                               ) : (
                                 <ImageIcon className="w-5 h-5 text-[#9E9E9E]" />
                               )}
                            </div>
                            <div className="overflow-hidden">
                              <p className="text-sm font-medium truncate">{item.name}</p>
                              {item.url && <p className="text-[10px] text-[#757575] truncate max-w-[200px]">{item.url}</p>}
                              <p className="text-[10px] text-[#757575] uppercase tracking-wider">{item.status}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            {item.status === 'done' && item.result && (
                              <div className="flex gap-3">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${item.result.hasModel ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                  {item.result.hasModel ? '有模特' : '无模特'}
                                </span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${item.result.isMainProductShot ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                                  {item.result.isMainProductShot ? '模拍图' : '非模拍'}
                                </span>
                              </div>
                            )}
                            {item.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-black" />}
                            <button 
                              onClick={() => removeBatchItem(idx)}
                              className="text-[#9E9E9E] hover:text-red-500 transition-colors p-1"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              </div>
            )}
          </div>
        </section>

        {/* Results Section */}
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              key="error-box"
              className="max-w-2xl mx-auto mb-12 p-4 bg-[#FFF5F5] border border-[#FECACA] rounded-xl flex items-start gap-3 text-[#B91C1C]"
            >
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-sm">解析出错</p>
                <p className="text-sm opacity-90">{error}</p>
              </div>
            </motion.div>
          )}

          {result && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              key="result-box"
              className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start"
            >
              {/* Preview */}
              <div className="bg-white p-2 rounded-3xl shadow-lg shadow-black/5 overflow-hidden border border-[#E0E0E0]">
                <div className="aspect-square bg-[#F9F9F9] rounded-2xl overflow-hidden relative">
                  <img
                    src={imageUrl}
                    alt="Preview"
                    className="w-full h-full object-contain"
                    onError={() => setError('图片无法加载，请检查链接是否有效')}
                  />
                  <div className="absolute top-4 right-4 bg-white/90 backdrop-blur px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border border-[#E0E0E0]">
                    Preview
                  </div>
                </div>
              </div>

              {/* Analysis */}
              <div className="space-y-6">
                <div className="bg-white p-8 rounded-3xl border border-[#E0E0E0] shadow-sm">
                  <div className="mb-8 flex items-center justify-between">
                    <h3 className="text-lg font-bold">分析报告</h3>
                    <div className="flex gap-2">
                       <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1 ${result.confidence > 0.8 ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#FFFBEB] text-[#B45309]'}`}>
                        {(result.confidence * 100).toFixed(0)}% 置信度
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-8">
                    <div className={`p-4 rounded-2xl border flex flex-col items-center justify-center gap-2 transition-all ${result.hasModel ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]' : 'bg-[#F9FAFB] border-[#E5E7EB] text-[#4B5563]'}`}>
                      <User className={`w-6 h-6 ${result.hasModel ? 'opacity-100' : 'opacity-40'}`} />
                      <span className="text-xs font-bold uppercase tracking-tighter">模特：{result.hasModel ? '有' : '无'}</span>
                      {result.hasModel ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4 opacity-40" />}
                    </div>
                    <div className={`p-4 rounded-2xl border flex flex-col items-center justify-center gap-2 transition-all ${result.isMainProductShot ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]' : 'bg-[#F9FAFB] border-[#E5E7EB] text-[#4B5563]'}`}>
                      <Camera className={`w-6 h-6 ${result.isMainProductShot ? 'opacity-100' : 'opacity-40'}`} />
                      <span className="text-xs font-bold uppercase tracking-tighter">模拍主图：{result.isMainProductShot ? '是' : '否'}</span>
                      {result.isMainProductShot ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4 opacity-40" />}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="pt-4 border-t border-[#E0E0E0]">
                      <p className="text-sm text-[#757575] italic">分析已简化以提高处理速度。仅判断是否为模拍主图。</p>
                    </div>
                  </div>
                </div>

                <div className="bg-[#1A1A1A] p-6 rounded-3xl text-white overflow-hidden relative group">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">Raw Response</span>
                    <button 
                      onClick={() => navigator.clipboard.writeText(JSON.stringify(result, null, 2))}
                      className="text-[10px] bg-white/10 hover:bg-white/20 px-2 py-1 rounded transition-colors uppercase"
                    >
                      Copy JSON
                    </button>
                  </div>
                  <pre className="text-xs font-mono opacity-80 overflow-x-auto">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* History / Placeholders */}
        {!result && !analyzing && singleHistory.length > 0 && (
          <section className="mt-12">
            <h3 className="text-sm font-bold text-[#9E9E9E] uppercase tracking-widest mb-6">最近分析</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {singleHistory.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setImageUrl(item.url);
                    setResult(item.result);
                  }}
                  className="aspect-square bg-white rounded-2xl border border-[#E0E0E0] p-2 hover:border-black transition-all group overflow-hidden"
                >
                  <img src={item.url} className="w-full h-full object-cover rounded-xl group-hover:scale-105 transition-transform" />
                </button>
              ))}
            </div>
          </section>
        )}

        {!result && !analyzing && singleHistory.length === 0 && (
          <div className="mt-20 flex flex-col items-center justify-center text-[#9E9E9E] opacity-50">
            <ImageIcon className="w-16 h-16 mb-4" />
            <p className="text-sm">暂无分析结果，请输入图片链接开始</p>
          </div>
        )}
            </motion.div>
          ) : (
            <motion.div 
              key="history-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-4xl mx-auto"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-light">历史分析库</h2>
                <div className="text-xs font-medium text-[#757575] bg-[#E0E0E0] px-3 py-1 rounded-full uppercase tracking-widest">
                  {fullHistory.length} Sessions Saved
                </div>
              </div>

              {fullHistory.length === 0 ? (
                <div className="bg-white border border-[#E0E0E0] rounded-3xl p-20 text-center">
                  <History className="w-16 h-16 mx-auto mb-4 text-[#E0E0E0]" />
                  <p className="text-[#9E9E9E]">暂无历史记录</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6">
                  {fullHistory.map((session) => (
                    <motion.div 
                      key={session.id}
                      layout
                      className="bg-white border border-[#E0E0E0] rounded-3xl overflow-hidden hover:shadow-xl hover:shadow-black/5 transition-all"
                    >
                      <div className="p-6">
                        <div className="flex items-start justify-between mb-6">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-[#F5F5F5] rounded-2xl flex items-center justify-center">
                              <FileText className="w-6 h-6 text-[#1A1A1A]" />
                            </div>
                            <div>
                              <h3 className="font-bold text-lg truncate max-w-[300px]">{session.name}</h3>
                              <div className="flex items-center gap-2 text-xs text-[#757575] mt-1">
                                <Calendar className="w-3 h-3" />
                                {session.date}
                              </div>
                            </div>
                          </div>
                          <button 
                            onClick={() => deleteHistoryItem(session.id)}
                            className="p-2 hover:bg-red-50 text-[#9E9E9E] hover:text-red-500 rounded-xl transition-colors"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-8 p-6 bg-[#F9F9F9] rounded-2xl border border-[#F0F0F0] mb-6">
                          <div className="text-center">
                            <p className="text-[10px] uppercase tracking-widest text-[#9E9E9E] font-bold mb-1">图片总数</p>
                            <p className="text-2xl font-light">{session.summary.total}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[10px] uppercase tracking-widest text-[#9E9E9E] font-bold mb-1">模特占比</p>
                            <p className="text-2xl font-light text-[#059669]">
                              {((session.summary.withModel / session.summary.total) * 100).toFixed(0)}%
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-[10px] uppercase tracking-widest text-[#9E9E9E] font-bold mb-1">成功率</p>
                            <p className="text-2xl font-light">
                              {((session.summary.success / session.summary.total) * 100).toFixed(0)}%
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-3">
                           <button 
                            onClick={() => {
                              const data = session.results.map(r => ({
                                '文件名/链接': r.name,
                                '是否模拍主图': r.isMainProductShot ? 'TRUE' : 'FALSE',
                                '置信度': `${(r.confidence * 100).toFixed(0)}%`,
                                '所属列': r.columnName || '-'
                              }));
                              const ws = XLSX.utils.json_to_sheet(data);
                              const wb = XLSX.utils.book_new();
                              XLSX.utils.book_append_sheet(wb, ws, "HistoryExport");
                              XLSX.writeFile(wb, `History_${session.id}.xlsx`);
                            }}
                            className="flex items-center gap-2 px-6 py-2.5 bg-black text-white rounded-xl text-sm font-bold hover:bg-[#333] transition-all"
                          >
                            <Download className="w-4 h-4" />
                            重导预览 Excel
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="mt-20 border-t border-[#E0E0E0] bg-white py-12">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-xs text-[#9E9E9E] uppercase tracking-widest mb-4">Powered by Qwen AI Vision</p>
          <p className="text-xs text-[#757575]">
            © 2026 ModelShot AI. 专为电商运营打造的智能图片分析工具。
          </p>
        </div>
      </footer>
    </div>
  );
}

