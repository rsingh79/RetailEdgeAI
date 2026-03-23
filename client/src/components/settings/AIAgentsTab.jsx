import { useState, useEffect } from 'react';
import { api } from '../../services/api';

const AGENT_ICONS = {
  ocr_extraction: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  product_matching: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  ),
  business_advisor: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  ),
  prompt_management: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};

const AGENT_LABELS = {
  ocr_extraction: 'Invoice OCR',
  product_matching: 'Product Matching',
  business_advisor: 'Business AI Advisor',
  prompt_management: 'Prompt Config Assistant',
};

const AGENT_DESCRIPTIONS = {
  ocr_extraction: 'Extracts structured data from invoices using AI vision',
  product_matching: 'Matches invoice lines to your product catalog',
  business_advisor: 'Interactive advisor that queries your business data',
  prompt_management: 'Helps configure AI agent behaviour via chat',
};

const ACTION_BADGES = {
  add: { label: 'Added', color: 'bg-green-100 text-green-700' },
  remove: { label: 'Removed', color: 'bg-red-100 text-red-700' },
  replace: { label: 'Replaced', color: 'bg-amber-100 text-amber-700' },
};

const CATEGORY_BADGES = {
  rule: 'bg-blue-50 text-blue-700',
  format: 'bg-purple-50 text-purple-700',
  constraint: 'bg-orange-50 text-orange-700',
  example: 'bg-teal-50 text-teal-700',
};

export default function AIAgentsTab() {
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [conditions, setConditions] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [effectivePrompt, setEffectivePrompt] = useState('');
  const [changeLog, setChangeLog] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [showChangeLog, setShowChangeLog] = useState(false);
  const [addingInstruction, setAddingInstruction] = useState(false);
  const [newInstruction, setNewInstruction] = useState('');
  const [newCategory, setNewCategory] = useState('rule');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Load agent list
  useEffect(() => {
    (async () => {
      try {
        const data = await api.prompts.getAgents();
        setAgents(data);
        if (data.length > 0) {
          setSelectedAgent(data[0].key);
        }
      } catch (err) {
        setError('Failed to load agents');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load conditions + overrides when agent changes
  useEffect(() => {
    if (!selectedAgent) return;
    (async () => {
      try {
        const [condData, conflictData, logData] = await Promise.all([
          api.prompts.getConditions(selectedAgent),
          api.prompts.getConflicts(),
          api.prompts.getChangeLog(20),
        ]);
        setConditions(condData.conditions || []);
        setOverrides(condData.overrides || []);
        setEffectivePrompt(condData.effectivePrompt || '');
        setConflicts(conflictData.filter((c) => !c.resolution));
        setChangeLog(logData.filter((l) => l.agentTypeKey === selectedAgent));
      } catch (err) {
        setError('Failed to load agent configuration');
      }
    })();
  }, [selectedAgent]);

  const handleAddInstruction = async () => {
    if (!newInstruction.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.prompts.addOverride(selectedAgent, {
        action: 'add',
        customText: newInstruction.trim(),
        category: newCategory,
      });
      // Refresh
      const condData = await api.prompts.getConditions(selectedAgent);
      setConditions(condData.conditions || []);
      setOverrides(condData.overrides || []);
      setEffectivePrompt(condData.effectivePrompt || '');
      setNewInstruction('');
      setAddingInstruction(false);
    } catch (err) {
      setError(err.message || 'Failed to add instruction');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveOverride = async (overrideId) => {
    setSaving(true);
    setError(null);
    try {
      await api.prompts.deleteOverride(overrideId);
      const condData = await api.prompts.getConditions(selectedAgent);
      setConditions(condData.conditions || []);
      setOverrides(condData.overrides || []);
      setEffectivePrompt(condData.effectivePrompt || '');
    } catch (err) {
      setError(err.message || 'Failed to remove override');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCondition = async (condition) => {
    if (condition.isRequired) return;
    setSaving(true);
    setError(null);

    // Check if already removed
    const existingRemoval = overrides.find(
      (o) => o.promptConditionId === condition.id && o.action === 'remove' && o.isActive
    );

    try {
      if (existingRemoval) {
        // Re-enable: delete the removal override
        await api.prompts.deleteOverride(existingRemoval.id);
      } else {
        // Disable: create a removal override
        await api.prompts.addOverride(selectedAgent, {
          action: 'remove',
          promptConditionId: condition.id,
          conditionKey: condition.key,
        });
      }
      const condData = await api.prompts.getConditions(selectedAgent);
      setConditions(condData.conditions || []);
      setOverrides(condData.overrides || []);
      setEffectivePrompt(condData.effectivePrompt || '');
    } catch (err) {
      setError(err.message || 'Failed to update condition');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
        Loading AI agents...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Agent selector cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {agents.map((agent) => {
          const isSelected = selectedAgent === agent.key;
          const agentConflicts = conflicts.filter((c) =>
            conditions?.some((cond) => cond.id === c.promptConditionId)
          );
          return (
            <button
              key={agent.key}
              onClick={() => setSelectedAgent(agent.key)}
              className={`text-left p-4 rounded-xl border-2 transition-all ${
                isSelected
                  ? 'border-teal-500 bg-teal-50/50 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
              }`}
            >
              <div className="flex items-center gap-2.5 mb-1.5">
                <span className={isSelected ? 'text-teal-600' : 'text-gray-400'}>
                  {AGENT_ICONS[agent.key] || AGENT_ICONS.prompt_management}
                </span>
                <span className={`text-sm font-semibold ${isSelected ? 'text-teal-700' : 'text-gray-700'}`}>
                  {AGENT_LABELS[agent.key] || agent.name}
                </span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                {AGENT_DESCRIPTIONS[agent.key] || agent.description}
              </p>
              {agentConflicts.length > 0 && (
                <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                  {agentConflicts.length} conflict{agentConflicts.length > 1 ? 's' : ''}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected agent detail */}
      {selectedAgent && conditions && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                {AGENT_LABELS[selectedAgent]} — Prompt Configuration
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {conditions.length} base condition{conditions.length !== 1 ? 's' : ''} &middot;{' '}
                {overrides.filter((o) => o.isActive).length} tenant override{overrides.filter((o) => o.isActive).length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowChangeLog(!showChangeLog)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
              >
                {showChangeLog ? 'Hide History' : 'Change History'}
              </button>
              <button
                onClick={() => setShowPromptPreview(!showPromptPreview)}
                className="px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition"
              >
                {showPromptPreview ? 'Hide Preview' : 'Preview Prompt'}
              </button>
            </div>
          </div>

          {/* Prompt preview */}
          {showPromptPreview && (
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-2">Effective prompt (what the AI sees):</p>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-white border border-gray-200 rounded-lg p-4 max-h-64 overflow-y-auto leading-relaxed">
                {effectivePrompt || 'No prompt data available'}
              </pre>
            </div>
          )}

          {/* Change log */}
          {showChangeLog && (
            <div className="px-6 py-4 bg-amber-50/50 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-2">Recent changes:</p>
              {changeLog.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No changes recorded yet</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {changeLog.map((log) => (
                    <div key={log.id} className="flex items-start gap-2 text-xs">
                      <span className="text-gray-400 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleDateString('en-AU', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        log.changeType.includes('add') ? 'bg-green-100 text-green-700' :
                        log.changeType.includes('remove') ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {log.changeType.replace(/_/g, ' ')}
                      </span>
                      <span className="text-gray-600 truncate">{log.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Conditions list */}
          <div className="divide-y divide-gray-50">
            {conditions.map((condition) => {
              const isRemoved = overrides.some(
                (o) => o.promptConditionId === condition.id && o.action === 'remove' && o.isActive
              );
              const replacement = overrides.find(
                (o) => o.promptConditionId === condition.id && o.action === 'replace' && o.isActive
              );

              return (
                <div
                  key={condition.id}
                  className={`px-6 py-3.5 flex items-start gap-3 ${isRemoved ? 'opacity-40' : ''}`}
                >
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggleCondition(condition)}
                    disabled={condition.isRequired || saving}
                    className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition ${
                      condition.isRequired
                        ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
                        : isRemoved
                        ? 'border-gray-300 bg-white cursor-pointer hover:border-teal-400'
                        : 'border-teal-500 bg-teal-500 cursor-pointer hover:bg-teal-600'
                    }`}
                  >
                    {!isRemoved && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-gray-400">{condition.key}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CATEGORY_BADGES[condition.category] || CATEGORY_BADGES.rule}`}>
                        {condition.category}
                      </span>
                      {condition.isRequired && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                          required
                        </span>
                      )}
                      {replacement && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                          modified
                        </span>
                      )}
                    </div>
                    <p className={`text-sm text-gray-700 leading-relaxed ${isRemoved ? 'line-through' : ''}`}>
                      {replacement ? replacement.customText : condition.text}
                    </p>
                    {replacement && (
                      <p className="text-xs text-gray-400 mt-1 line-through">{condition.text}</p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Tenant-added overrides (action=add) */}
            {overrides
              .filter((o) => o.action === 'add' && o.isActive)
              .map((override) => (
                <div key={override.id} className="px-6 py-3.5 flex items-start gap-3 bg-teal-50/30">
                  <span className="mt-0.5 w-5 h-5 rounded border-2 border-teal-500 bg-teal-500 flex-shrink-0 flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-teal-600">custom</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ACTION_BADGES.add.color}`}>
                        {ACTION_BADGES.add.label}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CATEGORY_BADGES[override.category] || CATEGORY_BADGES.rule}`}>
                        {override.category}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">{override.customText}</p>
                  </div>
                  <button
                    onClick={() => handleRemoveOverride(override.id)}
                    disabled={saving}
                    className="mt-0.5 text-gray-400 hover:text-red-500 transition flex-shrink-0"
                    title="Remove this custom instruction"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
              ))}
          </div>

          {/* Add instruction */}
          <div className="px-6 py-4 border-t border-gray-100">
            {addingInstruction ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  >
                    <option value="rule">Rule</option>
                    <option value="format">Format</option>
                    <option value="constraint">Constraint</option>
                    <option value="example">Example</option>
                  </select>
                  <input
                    type="text"
                    value={newInstruction}
                    onChange={(e) => setNewInstruction(e.target.value)}
                    placeholder="Enter a custom instruction for this agent..."
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddInstruction()}
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setAddingInstruction(false); setNewInstruction(''); }}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddInstruction}
                    disabled={!newInstruction.trim() || saving}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition disabled:opacity-50"
                  >
                    {saving ? 'Adding...' : 'Add Instruction'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingInstruction(true)}
                className="flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700 font-medium transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add custom instruction
              </button>
            )}
          </div>

          {/* Conflicts */}
          {conflicts.length > 0 && (
            <div className="px-6 py-4 bg-amber-50 border-t border-amber-100">
              <h4 className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                Unresolved Conflicts ({conflicts.length})
              </h4>
              {conflicts.map((conflict) => (
                <div key={conflict.id} className="bg-white rounded-lg border border-amber-200 p-3 mb-2 last:mb-0">
                  <p className="text-xs text-gray-700 mb-1">{conflict.detectedReason}</p>
                  <p className="text-xs text-gray-500">
                    Your instruction: <span className="font-medium">{conflict.tenantOverrideText}</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
