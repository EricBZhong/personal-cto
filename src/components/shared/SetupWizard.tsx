'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWs } from '@/components/layout/DashboardShell';

export interface SetupStep {
  id: string;
  label: string;
  description: string;
  fieldName: string;
  fieldType: 'text' | 'password';
  placeholder: string;
  helpUrl?: string;
  helpText?: string;
}

export interface SetupPrompt {
  integration: string;
  title: string;
  description: string;
  steps: SetupStep[];
}

interface SetupWizardModalProps {
  setup: SetupPrompt;
  onClose: () => void;
}

export function SetupWizardModal({ setup, onClose }: SetupWizardModalProps) {
  const { send } = useWs();
  const [values, setValues] = useState<Record<string, string>>({});
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const step = setup.steps[currentStep];
  const isLastStep = currentStep === setup.steps.length - 1;
  const allFilled = setup.steps.every(s => (values[s.fieldName] || '').trim().length > 0);

  const handleSave = useCallback(() => {
    setSaving(true);
    const updates: Record<string, unknown> = {};
    for (const s of setup.steps) {
      if (values[s.fieldName]) {
        updates[s.fieldName] = values[s.fieldName];
      }
    }
    send('config:update', updates);
    setSaved(true);
    setSaving(false);
    setTimeout(() => onClose(), 1500);
  }, [send, setup, values, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-200">{setup.title}</h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-zinc-400 mt-1">{setup.description}</p>
        </div>

        {/* Step indicator */}
        {setup.steps.length > 1 && (
          <div className="px-6 pt-4 flex gap-2">
            {setup.steps.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setCurrentStep(i)}
                className={`flex-1 h-1.5 rounded-full transition-colors ${
                  i <= currentStep ? 'bg-blue-500' : 'bg-zinc-700'
                }`}
              />
            ))}
          </div>
        )}

        {/* Current step */}
        <div className="px-6 py-5">
          <div className="mb-4">
            <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
              Step {currentStep + 1} of {setup.steps.length}
            </span>
            <h3 className="text-sm font-medium text-zinc-200 mt-1 mb-1">{step.label}</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">{step.description}</p>
            {step.helpUrl && (
              <a
                href={step.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-1"
              >
                {step.helpText || 'Learn more'}
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>

          <input
            type={step.fieldType}
            value={values[step.fieldName] || ''}
            onChange={(e) => setValues({ ...values, [step.fieldName]: e.target.value })}
            placeholder={step.placeholder}
            autoFocus
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (isLastStep) {
                  if (allFilled) handleSave();
                } else {
                  setCurrentStep(currentStep + 1);
                }
              }
            }}
          />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between">
          <div>
            {currentStep > 0 && (
              <button
                onClick={() => setCurrentStep(currentStep - 1)}
                className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-green-400">Connected!</span>}
            {isLastStep ? (
              <button
                onClick={handleSave}
                disabled={!allFilled || saving}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Connect'}
              </button>
            ) : (
              <button
                onClick={() => setCurrentStep(currentStep + 1)}
                className="px-5 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium transition-colors"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
