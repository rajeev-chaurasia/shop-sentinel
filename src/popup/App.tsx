import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 p-6">
      <div className="bg-white rounded-lg shadow-xl p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">
          Welcome to Apex Radar
        </h1>
        <p className="text-gray-600 mb-6">
          A powerful Chrome Extension built with React, Vite, and TailwindCSS
        </p>
        
        <div className="bg-gray-100 rounded-lg p-4 mb-4">
          <p className="text-center text-2xl font-semibold text-gray-700 mb-2">
            Counter: {count}
          </p>
          <button
            onClick={() => setCount((count) => count + 1)}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded transition duration-200"
          >
            Increment
          </button>
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-500">
            Click the button to test the extension
          </p>
        </div>
      </div>
    </div>
  )
}

export default App
