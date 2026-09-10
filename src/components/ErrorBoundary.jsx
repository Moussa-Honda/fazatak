import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    try {
      localStorage.removeItem('fazatak_active_tab');
    } catch {}
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'حدث خطأ غير متوقع';

      return (
        <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white p-6 font-sans select-none" dir="rtl">
          <div className="bg-slate-800/95 border border-slate-700/80 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl backdrop-blur-xl text-center space-y-5">
            <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto text-3xl shadow-lg shadow-rose-500/10">
              ⚠️
            </div>

            <div>
              <h2 className="text-xl font-black text-white mb-1.5">
                حدث خطأ أثناء عرض هذه الصفحة
              </h2>
              <p className="text-slate-400 text-xs leading-relaxed">
                بياناتك ومعاملاتك محفوظة بأمان. يمكنك إعادة المحاولة أو العودة للشاشة الرئيسية للمتابعة.
              </p>
            </div>

            <div className="bg-slate-900/80 border border-slate-700/60 rounded-xl p-3 text-right overflow-hidden">
              <p className="text-[11px] font-mono text-rose-300 break-words line-clamp-3">
                {errorMessage}
              </p>
            </div>

            <div className="flex flex-col gap-2.5 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-600/25 active:scale-95 transition-all cursor-pointer"
              >
                🔄 إعادة المحاولة والتحديث
              </button>

              <button
                type="button"
                onClick={this.handleGoHome}
                className="w-full py-3 bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl font-bold text-xs border border-slate-600/50 active:scale-95 transition-all cursor-pointer"
              >
                🏠 العودة إلى الرئيسية
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
