import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initDatabase } from './services/database.js'
import './index.css'
import App from './App.jsx'

// Initialize database before rendering
initDatabase().then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}).catch(err => {
  console.error('Failed to initialize database:', err)
  createRoot(document.getElementById('root')).render(
    <div className="flex items-center justify-center h-screen bg-dark-900 text-white p-8 text-center">
      <h1>خطأ في تهيئة قاعدة البيانات</h1>
      <p>{err.message}</p>
    </div>
  )
})
