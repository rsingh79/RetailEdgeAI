import { useState, useRef, useEffect } from 'react';
import { api } from '../../services/api';

export default function SmartImport({ onClose, onImportComplete }) {
  const [step, setStep] = useState('upload'); // upload, analyzing, patterns, testing, importing, done
  const [uploadId, setUploadId] = useState(null);
  const [importJobId, setImportJobId] = useState(null);
  const [fileName, setFileName] = useState('');
  const [totalRows, setTotalRows] = useState(0);
  const [headers, setHeaders] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [importResults, setImportResults] = useState(null);
  const [systemName, setSystemName] = useState('');
  const [saveTemplate, setSaveTemplate] = useState(true);
  const [error, setError] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [templates, setTemplates] = useState([]);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load existing templates for autocomplete
  useEffect(() => {
    api.getImportTemplates().then(setTemplates).catch(() => {});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const stepIndex = { upload: 0, analyzing: 0, patterns: 1, testing: 2, importing: 2, done: 3 }[step] || 0;
  const progressPct = ((stepIndex + 1) / 4) * 100;

  // ── File selected (stage it, don't upload yet) ──
  const handleFileSelected = (file) => {
    setPendingFile(file);
    setFileName(file.name);
  };

  // ── Upload & Analyze (requires systemName) ──
  const handleUpload = async () => {
    if (!pendingFile || !systemName.trim()) return;
    setStep('analyzing');
    setError(null);

    const formData = new FormData();
    formData.append('file', pendingFile);
    formData.append('systemName', systemName.trim());

    try {
      const result = await api.smartImportUpload(formData);
      setUploadId(result.uploadId);
      setImportJobId(result.importJobId || null);
      setTotalRows(result.totalRows);
      setHeaders(result.headers);
      setAnalysis(result.analysis);
      setMessages([{ role: 'assistant', content: result.agentReply }]);
      setStep('patterns');
    } catch (err) {
      setError(err.message);
      setStep('upload');
    }
  };

  // ── Chat ──
  const sendMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    setMessages((prev) => [...prev, { role: 'user', content: msg }]);
    setChatLoading(true);

    try {
      const result = await api.smartImportChat(uploadId, importJobId, msg);
      setMessages((prev) => [...prev, { role: 'assistant', content: result.reply }]);
      if (result.patterns) setAnalysis((a) => ({ ...a, patterns: result.patterns }));
      if (result.columnMapping) setAnalysis((a) => ({ ...a, columnMapping: result.columnMapping }));

      // When agent confirms, auto-advance to test/import step
      if (result.status === 'confirmed' && result.testResults) {
        setTestResults(result.testResults);
        setStep('testing');
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Test Run ──
  const runTest = async () => {
    setStep('testing');
    try {
      const result = await api.smartImportTest(uploadId, importJobId);
      setTestResults(result);
    } catch (err) {
      setError(err.message);
      setStep('patterns');
    }
  };

  // ── Confirm Import ──
  const confirmImport = async () => {
    setStep('importing');
    try {
      const result = await api.smartImportConfirm(uploadId, importJobId, saveTemplate);
      // Normalise field names from new pipeline response
      const normalised = {
        created:         result.rowsCreated ?? result.created ?? 0,
        updated:         result.rowsUpdated ?? result.updated ?? 0,
        skipped:         result.rowsSkipped ?? result.skipped ?? 0,
        failed:          result.rowsFailed ?? result.failed ?? 0,
        pendingApproval: result.rowsPendingApproval ?? result.pendingApproval ?? 0,
        totalRows:       result.totalRows ?? 0,
        templateSaved:   result.templateSaved ?? false,
        templateName:    result.templateName ?? null,
        importJobId:     result.importJobId ?? null,
      };
      setImportResults(normalised);
      setStep('done');
    } catch (err) {
      setError(err.message);
      setStep('testing');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-black/40">
      <div className="flex w-full h-full bg-white">
        {/* ── Left: Chat Panel ── */}
        <div className="w-[420px] flex flex-col border-r border-gray-200 shrink-0">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200">
            <div className="w-9 h-9 bg-brand-600 rounded-[10px] flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-gray-900">Product Import Agent</h3>
              <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">Online</span>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {step === 'upload' && (
              <ChatBubble role="assistant">
                <strong>Welcome!</strong> I'll help you import your product data. Upload your file (CSV, Excel) and I'll analyze the structure, identify patterns, and create a mapping plan for you to review.
                <br /><br />
                Just drag & drop your file on the right, or click to browse.
              </ChatBubble>
            )}

            {step === 'analyzing' && (
              <ChatBubble role="assistant">
                <TypingDots /> <span className="text-gray-600 ml-1">Analyzing {fileName}...</span>
              </ChatBubble>
            )}

            {messages.map((msg, i) => (
              <ChatBubble key={i} role={msg.role}>{msg.content}</ChatBubble>
            ))}

            {chatLoading && <ChatBubble role="assistant"><TypingDots /></ChatBubble>}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          {(step === 'patterns' || step === 'testing') && (
            <div className="p-3 border-t border-gray-200 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Ask about the data or confirm patterns..."
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
              />
              <button onClick={sendMessage} disabled={chatLoading} className="bg-brand-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
                Send
              </button>
            </div>
          )}
        </div>

        {/* ── Right: Mapping Panel ── */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50 flex flex-col">
          <div className="flex-1">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">
                {error}
                <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
              </div>
            )}

            {/* ── Upload screen ── */}
            {step === 'upload' && (
              <div className="flex items-center justify-center h-full">
                <div className="max-w-lg w-full">
                  {/* System Name */}
                  <div className="mb-5">
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      What system is this file from? <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={systemName}
                      onChange={(e) => setSystemName(e.target.value)}
                      placeholder="e.g. Lightspeed POS, Shopify, WooCommerce"
                      list="system-suggestions"
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
                      autoFocus
                    />
                    <datalist id="system-suggestions">
                      {templates.map((t) => <option key={t.systemName} value={t.systemName} />)}
                    </datalist>
                    <p className="text-xs text-gray-500 mt-1.5">This name links the import to the export — so updated prices can be exported back in the same format.</p>
                  </div>

                  {/* File Drop Zone */}
                  <div
                    className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
                      pendingFile
                        ? 'border-brand-400 bg-brand-50/30'
                        : 'border-gray-300 hover:border-brand-400 hover:bg-brand-50/30'
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileSelected(f); }}
                  >
                    {pendingFile ? (
                      <>
                        <svg className="w-10 h-10 text-brand-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <h3 className="text-base font-semibold text-gray-800 mb-0.5">{pendingFile.name}</h3>
                        <p className="text-xs text-gray-500">{(pendingFile.size / 1024).toFixed(0)} KB — click to change file</p>
                      </>
                    ) : (
                      <>
                        <svg className="w-10 h-10 text-gray-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <h3 className="text-base font-semibold text-gray-700 mb-0.5">Drop your product file here</h3>
                        <p className="text-xs text-gray-500">or click to browse — CSV, XLS, XLSX (up to 10MB)</p>
                      </>
                    )}
                    <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files[0]) handleFileSelected(e.target.files[0]); }} />
                  </div>

                  {/* Analyze Button */}
                  <button
                    onClick={handleUpload}
                    disabled={!pendingFile || !systemName.trim()}
                    className="w-full mt-4 bg-brand-600 text-white px-5 py-3 rounded-lg text-sm font-semibold hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                  >
                    Analyze & Import
                  </button>
                </div>
              </div>
            )}

            {/* ── Analyzing spinner ── */}
            {step === 'analyzing' && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-16 h-16 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-700">Analyzing your data...</h3>
                  <p className="text-sm text-gray-500 mt-1">Reading columns, detecting patterns, proposing mappings</p>
                </div>
              </div>
            )}

            {/* ── Pattern Analysis ── */}
            {step === 'patterns' && analysis && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-lg font-bold text-gray-900">Pattern Analysis</h2>
                  <button onClick={runTest} className="bg-brand-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-brand-700">
                    Run Test
                  </button>
                </div>
                <p className="text-sm text-gray-500 mb-5">{fileName} — {totalRows} rows, {headers.length} columns</p>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                  <StatCard label="Total Rows" value={totalRows} color="text-brand-600" />
                  <StatCard label="Patterns" value={(analysis.patterns || []).length} color="text-indigo-600" />
                  <StatCard label="Columns" value={headers.length} color="text-amber-600" />
                  <StatCard label="GST Detected" value={analysis.gstDetected ? 'Yes' : 'No'} color={analysis.gstDetected ? 'text-red-600' : 'text-green-600'} />
                </div>

                {/* Column Mapping */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
                  <h3 className="font-semibold text-sm mb-3">Column Mapping</h3>
                  <div className="space-y-2">
                    {Object.entries(analysis.columnMapping || {}).map(([col, info]) => {
                      const target = typeof info === 'string' ? info : info?.target;
                      const note = typeof info === 'object' ? info?.note : null;
                      const isSkipped = target === 'skip';
                      return (
                        <div key={col} className={`flex items-center gap-2 ${isSkipped ? 'opacity-40' : ''}`}>
                          <div className="flex-1 bg-gray-100 rounded-md px-3 py-1.5 text-xs font-medium text-gray-700">{col}</div>
                          <span className="text-brand-600 font-bold text-base shrink-0">→</span>
                          <div className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${isSkipped ? 'bg-gray-100 text-gray-400' : 'bg-brand-50 text-brand-700 border border-brand-200'}`}>
                            {target || 'skip'}
                            {note && !isSkipped && <span className="text-gray-400 font-normal ml-1">({note})</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Pattern Cards */}
                {(analysis.patterns || []).map((pattern) => (
                  <PatternCard key={pattern.id} pattern={pattern} />
                ))}

                {/* Observations */}
                {analysis.observations?.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mt-2">
                    <h3 className="font-semibold text-sm text-blue-800 mb-2">Observations</h3>
                    <ul className="text-xs text-blue-700 space-y-1 list-disc pl-4">
                      {analysis.observations.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ── Test Results ── */}
            {step === 'testing' && testResults && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-lg font-bold text-gray-900">Test Run Results</h2>
                  <div className="flex gap-2">
                    <button onClick={() => setStep('patterns')} className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50">
                      Back to Patterns
                    </button>
                    <button onClick={confirmImport} className="bg-brand-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-brand-700">
                      Import {testResults.summary.successful} Products
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500 mb-5">Full transformation applied — review before importing</p>

                <div className={`grid gap-3 mb-6 ${testResults.hasVariants ? 'grid-cols-5' : 'grid-cols-4'}`}>
                  <StatCard label="Products" value={testResults.summary.successful} color="text-green-600" />
                  {testResults.hasVariants && (
                    <StatCard label="Variants" value={testResults.variantCount || 0} color="text-indigo-600" />
                  )}
                  <StatCard label="Warnings" value={testResults.summary.warnings} color="text-amber-600" />
                  <StatCard label="Failed" value={testResults.summary.failed} color="text-red-600" />
                  <StatCard label="Total Rows" value={testResults.summary.total} color="text-gray-600" />
                </div>

                {/* Sample transformations as mini-tables */}
                {testResults.sampleSuccessful?.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
                    <h3 className="font-semibold text-sm mb-3 text-green-700">Sample Transformations</h3>
                    <div className="space-y-3">
                      {testResults.sampleSuccessful.slice(0, 3).map((item, i) => (
                        <TestCaseCard key={i} item={item} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Warnings */}
                {testResults.sampleWarnings?.length > 0 && (
                  <div className="bg-white rounded-xl border border-amber-200 p-4 mb-4">
                    <h3 className="font-semibold text-sm mb-3 text-amber-700">Warnings (will still import)</h3>
                    {testResults.sampleWarnings.map((w, i) => (
                      <div key={i} className="text-xs text-amber-700 py-1.5 border-b border-amber-100 last:border-0">
                        <span className="font-medium">Row {w.rowIndex}:</span> {w.warning} — {w.product?.name || 'unnamed'}
                      </div>
                    ))}
                  </div>
                )}

                {/* Failed rows */}
                {testResults.allFailed?.length > 0 && (
                  <div className="bg-white rounded-xl border-l-4 border-l-red-500 border border-red-200 p-4 mb-4">
                    <h3 className="font-semibold text-sm mb-3 text-red-700">Failed Rows (will be skipped)</h3>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-red-100">
                          <th className="text-left py-1.5 font-semibold text-gray-500 w-16">Row</th>
                          <th className="text-left py-1.5 font-semibold text-gray-500">Issue</th>
                          <th className="text-left py-1.5 font-semibold text-gray-500">Source Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testResults.allFailed.map((f, i) => (
                          <tr key={i} className="border-b border-red-50 last:border-0">
                            <td className="py-1.5 text-gray-600">#{f.rowIndex}</td>
                            <td className="py-1.5 text-red-600">{f.reason}</td>
                            <td className="py-1.5 text-gray-500 truncate max-w-xs">{JSON.stringify(f.source)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Template info */}
                <div className="bg-brand-50 border border-brand-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <svg className="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-brand-800">
                      Import template for <strong>"{systemName}"</strong> will be saved automatically for future imports and exports.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Importing spinner ── */}
            {step === 'importing' && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-16 h-16 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-700">Importing products...</h3>
                </div>
              </div>
            )}

            {/* ── Import Complete ── */}
            {step === 'done' && importResults && (
              <div className="flex items-center justify-center h-full">
                <div className="max-w-lg w-full">
                  <div className="text-center mb-6">
                    <div className={`w-16 h-16 ${importResults.pendingApproval > 0 ? 'bg-amber-100' : 'bg-green-100'} rounded-full flex items-center justify-center mx-auto mb-4`}>
                      <svg className={`w-8 h-8 ${importResults.pendingApproval > 0 ? 'text-amber-600' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">
                      {importResults.pendingApproval > 0
                        ? `Import Complete — ${importResults.pendingApproval} products need your review`
                        : 'Import Complete — all products added to catalog'}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">{fileName}</p>
                  </div>

                  <div className={`grid gap-3 mb-6 ${importResults.pendingApproval > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                    <StatCard label="Created" value={importResults.created} color="text-green-600" />
                    <StatCard label="Updated" value={importResults.updated} color="text-blue-600" />
                    <StatCard label="Skipped" value={importResults.skipped} color="text-gray-400" />
                    {importResults.pendingApproval > 0 && (
                      <StatCard label="Awaiting Review" value={importResults.pendingApproval} color="text-amber-600" />
                    )}
                  </div>

                  {/* Saved template card */}
                  {importResults.templateSaved && (
                    <div className="bg-green-50 border border-green-200 border-l-4 border-l-green-500 rounded-xl p-4 mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm text-green-800">Template Saved: "{importResults.templateName}"</span>
                        <span className="text-[10px] font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Saved</span>
                      </div>
                      <p className="text-xs text-green-700">Next import from this POS will auto-apply these rules — you'll just need to confirm.</p>
                    </div>
                  )}

                  <div className="flex gap-3 justify-center">
                    <button onClick={onClose} className="bg-white border border-gray-300 text-gray-700 px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-gray-50">
                      Close
                    </button>
                    {importResults.pendingApproval > 0 && (
                      <button
                        onClick={() => { onClose(); window.location.href = '/products?showApprovalQueue=true'; }}
                        className="bg-amber-500 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-amber-600"
                      >
                        Review {importResults.pendingApproval} Pending Products
                      </button>
                    )}
                    <button
                      onClick={() => { onImportComplete?.(); onClose(); }}
                      className="bg-brand-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-700"
                    >
                      Go to Products
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Progress Bar — always visible at bottom */}
          {step !== 'upload' && (
            <div className="shrink-0 px-6 pb-4 pt-2">
              <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-brand-600 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="text-center text-xs text-gray-500 mt-2">
                Step {stepIndex + 1} of 4 — {['Analyzing file', 'Pattern review', 'Test & import', 'Complete'][stepIndex]}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function ChatBubble({ role, children }) {
  const isAgent = role === 'assistant';
  return (
    <div className={`max-w-[92%] rounded-xl p-3 text-[13px] leading-relaxed ${
      isAgent
        ? 'bg-teal-50 border border-teal-200 rounded-bl self-start'
        : 'bg-blue-50 border border-blue-200 rounded-br self-end ml-auto'
    }`}>
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
        {isAgent ? 'Import Agent' : 'You'}
      </div>
      <div className="whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 items-center">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function PatternCard({ pattern }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 border-l-4 border-l-brand-500 p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Pattern {pattern.id}: {pattern.label}</span>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {pattern.rowCount} rows {pattern.rowCount && totalPercent(pattern) ? `(${totalPercent(pattern)})` : ''}
          </span>
        </div>
      </div>
      <p className="text-xs text-gray-600 mb-2">{pattern.description}</p>

      {/* Transform rules */}
      {pattern.transformations?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">
          <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wide mb-1">Transform Rules</div>
          {pattern.transformations.map((t, i) => (
            <div key={i} className="text-xs text-amber-800 py-0.5">
              <code className="bg-amber-100 px-1 rounded text-[11px]">{t.field}</code>: {t.rule}
            </div>
          ))}
        </div>
      )}

      {/* Example rows as mini-table */}
      {pattern.exampleRows?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1 px-2 font-semibold text-gray-400 uppercase tracking-wide">Source</th>
                <th className="py-1 px-1 text-brand-600 font-bold text-center w-6"></th>
                <th className="text-left py-1 px-2 font-semibold text-gray-400 uppercase tracking-wide">Transformed</th>
              </tr>
            </thead>
            <tbody>
              {pattern.exampleRows.slice(0, 3).map((ex, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="py-1.5 px-2 text-gray-600">{typeof ex === 'string' ? ex : `Row ${ex}`}</td>
                  <td className="py-1.5 px-1 text-brand-600 font-bold text-center">→</td>
                  <td className="py-1.5 px-2 text-gray-900 font-medium">{typeof ex === 'string' ? ex : `(see test run)`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function totalPercent(pattern) {
  // Can't compute without total — just return null
  return null;
}

function TestCaseCard({ item }) {
  const fields = [
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category' },
    { key: 'baseUnit', label: 'Base Unit' },
    { key: 'size', label: 'Size' },
    { key: 'packSize', label: 'Pack Size' },
    { key: 'barcode', label: 'Barcode' },
    { key: 'costPrice', label: 'Cost (ex-GST)', format: (v) => `$${Number(v).toFixed(2)}` },
    { key: 'sellingPrice', label: 'Price (ex-GST)', format: (v) => `$${Number(v).toFixed(2)}` },
    { key: 'costPerUnit', label: 'Cost/Unit', format: (v) => `$${Number(v).toFixed(2)}` },
    { key: 'unitQty', label: 'Unit Qty' },
    { key: 'variantCount', label: 'Variants' },
  ].filter((f) => item[f.key] != null);

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
      <div className="text-[10px] font-bold text-green-600 uppercase tracking-wide mb-2">
        Product {item.rowIndex}{item.groupKey ? ` — ${item.groupKey}` : ''}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-green-200">
            <th className="text-left py-1 font-semibold text-gray-500 w-28">Field</th>
            <th className="text-left py-1 font-semibold text-gray-500">Value</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.key} className="border-b border-green-100 last:border-0">
              <td className="py-1 font-medium text-gray-600">{f.label}</td>
              <td className="py-1 text-gray-900">{f.format ? f.format(item[f.key]) : item[f.key]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Variant details */}
      {item.variants?.length > 0 && (
        <div className="mt-2 pt-2 border-t border-green-200">
          <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wide mb-1">Variants</div>
          <div className="space-y-1">
            {item.variants.map((v, i) => (
              <div key={i} className="flex items-center gap-3 text-xs text-gray-700 bg-white/60 rounded px-2 py-1">
                {v.sku && <span className="font-mono text-gray-500">{v.sku}</span>}
                <span className="font-medium">{v.name || 'Default'}</span>
                {v.size && <span className="text-gray-400">{v.size}</span>}
                {v.price != null && <span className="ml-auto font-medium">${Number(v.price).toFixed(2)}</span>}
              </div>
            ))}
            {item.variantCount > item.variants.length && (
              <div className="text-[10px] text-gray-400 pl-2">+{item.variantCount - item.variants.length} more</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
