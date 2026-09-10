import { Routes, Route } from 'react-router-dom'
import { useApp } from './context/AppContext'
import LoginPage from './components/LoginPage'
import Layout from './components/Layout'
import Home from './sections/Home'
import TestQCPage from './sections/TestQC/TestQCPage'
import TestQCAnalyzePage from './sections/TestQC/TestQCAnalyzePage'
import ManualPackingHome from './sections/ManualPacking/ManualPackingHome'
import CreateTestFlow from './sections/ManualPacking/CreateTestFlow'
import EditTestFlow from './sections/ManualPacking/EditTestFlow'
import SmartPackerPage from './sections/SmartPacker/SmartPackerPage'
import TopicAnalyserPage from './sections/TopicAnalyser/TopicAnalyserPage'
import SolutionForgePage from './sections/SolutionForge/SolutionForgePage'

export default function App() {
  const { token } = useApp()

  if (!token) return <LoginPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/test-qc" element={<TestQCPage />} />
        <Route path="/test-qc/analyze" element={<TestQCAnalyzePage />} />
        <Route path="/manual-packing" element={<ManualPackingHome />} />
        <Route path="/manual-packing/create" element={<CreateTestFlow />} />
        <Route path="/manual-packing/edit" element={<EditTestFlow />} />
        <Route path="/smart-packer" element={<SmartPackerPage />} />
        <Route path="/topic-analyser" element={<TopicAnalyserPage />} />
        <Route path="/solution-forge" element={<SolutionForgePage />} />
      </Route>
    </Routes>
  )
}
