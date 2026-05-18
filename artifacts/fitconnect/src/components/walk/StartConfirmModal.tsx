import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isMobile, isVoiceSupported, unlockVoice } from '../../services/voiceService';

interface StartConfirmModalProps {
  isOpen: boolean;
  routeName: string;
  distanceKm: number;
  durationMin: number;
  estimatedCalories: number;
  onStart: (voiceEnabled: boolean, keepScreenOn: boolean) => void;
  onClose: () => void;
}

export default function StartConfirmModal({
  isOpen, routeName, distanceKm, durationMin, estimatedCalories, onStart, onClose,
}: StartConfirmModalProps) {
  const { t, i18n } = useTranslation();
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [keepScreenOn, setKeepScreenOn] = useState(false);
  const { ios, android } = isMobile();

  useEffect(() => {
    if (isOpen) {
      setVoiceEnabled(false);
      setKeepScreenOn(ios);
    }
  }, [isOpen, ios]);

  if (!isOpen) return null;

  const handleVoiceActivate = () => {
    unlockVoice(i18n.language);
    setVoiceEnabled(true);
  };

  const handleStart = () => {
    onStart(voiceEnabled, keepScreenOn);
  };

  return (
    <div className="fixed inset-0 z-[400] flex items-end bg-black/60" onClick={onClose}>
      <div
        className="w-full bg-white rounded-t-3xl p-6 pb-10 safe-area-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-6" />

        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🚶</div>
          <h2 className="text-xl font-bold text-gray-900">{t('walk.nav_ready_title')}</h2>
          <p className="text-sm text-gray-500 mt-1">{routeName}</p>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: t('walk.distance'), value: `${distanceKm.toFixed(1)} km`, color: '#00C853' },
            { label: t('walk.duration'), value: `${durationMin} min`, color: '#6C5CE7' },
            { label: t('walk.est_calories'), value: `${estimatedCalories} kcal`, color: '#FF6B35' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center bg-gray-50 rounded-2xl p-3">
              <p style={{ color }} className="text-base font-bold">{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        <div className="space-y-3 mb-6">
          {ios && (
            <div className="flex items-start gap-3 bg-blue-50 rounded-xl px-4 py-3">
              <span className="text-blue-500 text-lg flex-shrink-0">📱</span>
              <p className="text-xs text-blue-700">{t('walk.nav_ios_hint')}</p>
            </div>
          )}
          {android && (
            <label className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={keepScreenOn}
                onChange={(e) => setKeepScreenOn(e.target.checked)}
                className="w-4 h-4 accent-[#00C853]"
              />
              <span className="text-sm text-gray-700">{t('walk.nav_keep_screen_on')}</span>
            </label>
          )}
          {isVoiceSupported() && (
            <button
              type="button"
              onClick={handleVoiceActivate}
              disabled={voiceEnabled}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all"
              style={voiceEnabled
                ? { borderColor: '#00C853', background: '#00C853/5', color: '#00C853' }
                : { borderColor: '#e5e5e5', color: '#666' }
              }
            >
              <span className="text-lg">{voiceEnabled ? '🔊' : '🔇'}</span>
              <span className="text-sm font-medium flex-1 text-left">
                {voiceEnabled ? t('walk.nav_voice_active') : t('walk.nav_activate_voice')}
              </span>
              {voiceEnabled && (
                <svg className="w-4 h-4 text-[#00C853]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleStart}
          className="w-full py-4 rounded-2xl text-white font-bold text-base shadow-sm"
          style={{ background: 'linear-gradient(135deg, #00C853, #00B8D4)' }}
        >
          {t('walk.nav_start_walking')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 mt-2 text-sm text-gray-400"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
