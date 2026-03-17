const CheckCircle = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  </svg>
);

const ChevronRight = () => (
  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);

const UploadIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
  </svg>
);

const ExportIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

const steps = [
  { num: 1, label: '1. Upload' },
  { num: 2, label: '2. Review & Price' },
  { num: 3, label: '3. Export' },
];

const activeStyles = {
  1: 'bg-blue-100 text-blue-700',
  2: 'bg-amber-100 text-amber-700',
  3: 'bg-emerald-100 text-emerald-700',
};

export default function WorkflowBreadcrumb({ step }) {
  return (
    <div className="flex items-center gap-2 text-sm mb-4">
      {steps.map((s, i) => {
        const isCompleted = s.num < step;
        const isActive = s.num === step;
        const isFuture = s.num > step;

        return (
          <div key={s.num} className="flex items-center gap-2">
            {i > 0 && <ChevronRight />}
            {isCompleted && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-emerald-600 rounded-full">
                <CheckCircle />
                {s.label}
              </div>
            )}
            {isActive && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-medium ${activeStyles[s.num]}`}>
                {s.num === 1 && <UploadIcon />}
                {s.num === 3 && <ExportIcon />}
                {s.label}
              </div>
            )}
            {isFuture && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-gray-400 rounded-full">
                {s.label}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
