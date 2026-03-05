import { EditOutlined, FileImageOutlined, FunctionOutlined, UploadOutlined, VideoCameraOutlined } from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd';
import { Button, Input, message, Modal, Progress, Radio, Space, Typography, Upload } from 'antd';
import 'katex/dist/katex.min.css';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import './App.css';
import { compressImage } from './compress';

const { TextArea } = Input;
const { Text } = Typography;

const TOTAL_DURATION = 2 * 60 * 1000; // 3分钟

function App() {
  const [inputMode, setInputMode] = useState<'text' | 'image'>('text');
  const [problemText, setProblemText] = useState('');
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [messageText, setMessageText] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [problemAnalysis, setProblemAnalysis] = useState('');
  const [currentNode, setCurrentNode] = useState('');
  // 题目选择相关状态
  const [questions, setQuestions] = useState<string[]>([]);
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState<number | null>(null);
  const [needSelectQuestion, setNeedSelectQuestion] = useState(false);
  const [threadId, setThreadId] = useState('');
  const [selectLoading, setSelectLoading] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const analysisRef = useRef<HTMLDivElement>(null);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
    };
  }, []);

  // 当解题思路出现时，滚动到可视区域
  useEffect(() => {
    if (problemAnalysis && analysisRef.current) {
      analysisRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [problemAnalysis]);

  // 全局监听粘贴事件，支持在图片模式下粘贴图片
  useEffect(() => {
    async function handleGlobalPaste(e: ClipboardEvent) {
      if (inputMode !== 'image') return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          e.preventDefault();
          const file = items[i].getAsFile();
          if (file) {
            // 压缩图片
            const compressedFile = await compressImage(file);
            const fileName = `screenshot_${Date.now()}.jpg`;
            // 创建符合 Ant Design Upload 格式的文件对象
            const uploadFile: UploadFile = {
              uid: `-${Date.now()}`,
              name: fileName,
              status: 'done',
              size: compressedFile.size,
              type: compressedFile.type,
              lastModifiedDate: new Date(),
              originFileObj: compressedFile as unknown as UploadFile['originFileObj'],
            };
            setFileList([uploadFile]);
            message.success('图片已粘贴并压缩');
          }
          return;
        }
      }
    }

    document.addEventListener('paste', handleGlobalPaste);
    return () => {
      document.removeEventListener('paste', handleGlobalPaste);
    };
  }, [inputMode]);

  const uploadProps: UploadProps = {
    accept: 'image/*',
    maxCount: 1,
    fileList,
    beforeUpload: async (file) => {
      const isImage = file.type.startsWith('image/');
      if (!isImage) {
        message.error('只能上传图片文件!');
        return false;
      }
      // 压缩图片
      const compressedFile = await compressImage(file);
      setFileList([compressedFile as unknown as UploadFile]);
      return false;
    },
    onRemove: () => {
      setFileList([]);
    },
    showUploadList: false
  };

  async function generateVideo() {
    // 验证输入
    if (inputMode === 'text' && !problemText.trim()) {
      message.warning('请输入数学题目');
      return;
    }
    if (inputMode === 'image' && fileList.length === 0) {
      message.warning('请上传题目图片');
      return;
    }

    setLoading(true);
    setMessageText('正在生成视频...');
    setVideoUrl('');
    setProgress(0);
    setProblemAnalysis('');
    setCurrentNode('');
    setSelectedQuestionIndex(null);
    startTimeRef.current = Date.now();

    // 启动进度条定时器
    const updateInterval = 1000; // 每秒更新一次
    progressTimerRef.current = window.setInterval(() => {
      if (startTimeRef.current) {
        const elapsed = Date.now() - startTimeRef.current;
        const newProgress = Math.min(Math.floor((elapsed / TOTAL_DURATION) * 100), 99);
        setProgress(newProgress);
      }
    }, updateInterval);

    // 创建 FormData
    const formData = new FormData();

    if (inputMode === 'text') {
      formData.append('problemText', problemText);
    } else if (fileList[0]) {
      // Ant Design Upload 组件中，beforeUpload 返回 false 时，file 对象本身就可以用
      const file = fileList[0].originFileObj || fileList[0] as unknown as File;
      formData.append('image', file);
    }

    // 根据输入模式调用不同的接口
    const endpoint = inputMode === 'text' ? '/api/generate' : '/api/upload';

    // 创建 AbortController 用于停止请求
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      if (!response || !response.ok || !response.body) {
        throw new Error('请求失败');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const text = decoder.decode(value);
        const lines = text.replaceAll('data: ', '').split('\n\n').filter(line => line.trim() !== '');

        // 处理所有消息行
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            console.log(json, 'json');
            if (json.type === 'message') {
              setCurrentNode(json.content);
            } else if (json.type === 'analyzeProblem') {
              setMessageText(json.content);
              // 保存解题思路
              if (json.content && json.content.length > 50) {
                setProblemAnalysis(json.content);
              }
            } else if (json.type === 'questions' && json.needSelect) {
              // 多道题，需要用户选择
              console.log('需要选择题目:', json.questions);
              setQuestions(json.questions);
              setThreadId(json.threadId);
              setProblemAnalysis(json.problemAnalysis || '');
              setNeedSelectQuestion(true);
              setSelectedQuestionIndex(null);
              setLoading(false);
              // 停止进度条
              if (progressTimerRef.current) {
                clearInterval(progressTimerRef.current);
                progressTimerRef.current = null;
              }
              setProgress(0);
              return; // 结束当前请求处理，等待用户选择
            } else if (json.type === 'success') {
              setVideoUrl(json.videoUrl);
              setVideoModalOpen(true);
              setMessageText('视频生成成功！');
              // 立即停止进度条和 loading
              if (progressTimerRef.current) {
                clearInterval(progressTimerRef.current);
                progressTimerRef.current = null;
              }
              setProgress(100);
              setLoading(false);
            } else if (json.type === 'error') {
              setMessageText(json.content || '生成失败');
              message.error(json.content || '生成失败');
              // 停止进度条和 loading
              if (progressTimerRef.current) {
                clearInterval(progressTimerRef.current);
                progressTimerRef.current = null;
              }
              setProgress(0);
              setLoading(false);
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setMessageText('已停止生成');
        message.info('已停止生成');
      } else {
        setMessageText('生成失败，请重试');
        message.error('生成失败');
      }
    } finally {
      // 清除定时器
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      // 清除 abort controller
      abortControllerRef.current = null;
      // 重置进度
      setProgress(0);
      setLoading(false);
    }
  }

  function stopGeneration() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }

  // 用户选择题目后继续生成视频
  async function selectQuestion(index: number) {
    if (!threadId) return;

    setSelectLoading(true);
    setLoading(true);
    setMessageText('正在生成视频...');
    setProgress(0);
    startTimeRef.current = Date.now();

    // 启动进度条定时器
    const updateInterval = 1000;
    progressTimerRef.current = window.setInterval(() => {
      if (startTimeRef.current) {
        const elapsed = Date.now() - startTimeRef.current;
        const newProgress = Math.min(Math.floor((elapsed / TOTAL_DURATION) * 100), 99);
        setProgress(newProgress);
      }
    }, updateInterval);

    try {
      const response = await fetch('/api/resume', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          threadId,
          selectedIndex: index,
        }),
      });

      if (!response || !response.ok || !response.body) {
        throw new Error('请求失败');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const text = decoder.decode(value);
        const lines = text.replaceAll('data: ', '').split('\n\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            console.log(json, 'json');
            if (json.type === 'message') {
              setCurrentNode(json.content);
            } else if (json.type === 'analyzeProblem') {
              setMessageText(json.content);
              if (json.content && json.content.length > 50) {
                setProblemAnalysis(json.content);
              }
            } else if (json.type === 'success') {
              setVideoUrl(json.videoUrl);
              setVideoModalOpen(true);
              setMessageText('视频生成成功！');
              if (progressTimerRef.current) {
                clearInterval(progressTimerRef.current);
                progressTimerRef.current = null;
              }
              setProgress(100);
              setLoading(false);
              // 重置选择状态
              setNeedSelectQuestion(false);
              setQuestions([]);
              setThreadId('');
              setSelectedQuestionIndex(null);
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setMessageText('已停止生成');
        message.info('已停止生成');
      } else {
        setMessageText('生成失败，请重试');
        message.error('生成失败');
      }
    } finally {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      abortControllerRef.current = null;
      setProgress(0);
      setLoading(false);
      setSelectLoading(false);
    }
  }

  async function downloadVideo() {
    if (!videoUrl) {
      return;
    }

    const res = await fetch(videoUrl);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    // 从 videoUrl 中提取文件名
    const fileName = videoUrl.split('/').pop() || 'video.mp4';

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();

    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-decoration">
          <div className="header-icon"><FunctionOutlined /></div>
          <div className="header-icon"><EditOutlined /></div>
          <div className="header-icon"><VideoCameraOutlined /></div>
        </div>
        <h1>数学视频生成器</h1>
        <Text type="secondary">输入数学题目或上传图片，自动生成讲解视频</Text>
      </header>

      <main className="app-main">
        <div className="input-section">
          <div className="mode-selector">
            <Radio.Group
              value={inputMode}
              onChange={(e) => {
                setInputMode(e.target.value);
                setMessageText('');
                // 重置题目选择状态
                setNeedSelectQuestion(false);
                setQuestions([]);
                setThreadId('');
                setSelectedQuestionIndex(null);
              }}
              buttonStyle="solid"
            >
              <Radio.Button value="text">
                <Space>
                  <UploadOutlined />
                  文本输入
                </Space>
              </Radio.Button>
              <Radio.Button value="image">
                <Space>
                  <FileImageOutlined />
                  图片上传
                </Space>
              </Radio.Button>
            </Radio.Group>
          </div>

          <div className="input-content">
            {inputMode === 'text' ? (
              <div className="text-input-wrapper">
                <TextArea
                  placeholder="请输入数学题目，例如：计算下列函数的导数 f(x) = x^3 + 2x^2 - 5x + 1"
                  rows={6}
                  value={problemText}
                  onChange={(e) => setProblemText(e.target.value)}
                  className="problem-textarea"
                  showCount
                  maxLength={2000}
                />
              </div>
            ) : (
              <div className="image-upload-wrapper">
                <Upload.Dragger {...uploadProps}>
                  <p className="ant-upload-drag-icon">
                    <FileImageOutlined style={{ fontSize: 48, color: '#1890ff' }} />
                  </p>
                  <p className="ant-upload-text">点击或拖拽图片到此区域，也支持 Ctrl+V 粘贴</p>
                  <p className="ant-upload-hint">
                    支持单个图片文件，格式支持 jpg、png、gif 等
                  </p>
                </Upload.Dragger>
                {fileList.length > 0 && (
                  <div className="preview-tip">
                    已选择: {fileList[0].name}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="action-section">
            {loading ? (
              <Button
                size="large"
                onClick={stopGeneration}
                danger
              >
                停止
              </Button>
            ) : (
              <Button
                type="primary"
                size="large"
                onClick={generateVideo}
                className="generate-btn"
              >
                生成视频
              </Button>
            )}
          </div>

          {/* 题目选择区域 */}
          {needSelectQuestion && questions.length > 0 && (
            <div className="questions-select-wrapper">
              <Text strong style={{ display: 'block', marginBottom: 12 }}>
                检测到 {questions.length} 道题目，请选择一道：
              </Text>
              <div className="questions-list">
                {questions.map((q, index) => {
                  const isSelected = selectedQuestionIndex === index;
                  return (
                    <div
                      key={index}
                      className={`question-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        if (selectLoading) return;
                        setSelectedQuestionIndex(index);
                        selectQuestion(index);
                      }}
                      style={{
                        padding: '12px 16px',
                        marginBottom: 8,
                        border: isSelected ? '2px solid #1890ff' : '1px solid #d9d9d9',
                        borderRadius: 6,
                        cursor: selectLoading ? 'not-allowed' : 'pointer',
                        background: isSelected ? '#e6f7ff' : selectLoading ? '#f5f5f5' : '#fff',
                        transition: 'all 0.3s',
                      }}
                    >
                      <Text strong style={{ marginRight: 8 }}>{index + 1}.</Text>
                      <Text style={{ flex: 1 }}>{q.length > 80 ? q.substring(0, 80) + '...' : q}</Text>
                      {isSelected && selectLoading && (
                        <Text type="secondary" style={{ marginLeft: 8 }}>处理中...</Text>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {loading && (
            <div className="progress-wrapper">
              <Progress percent={progress} status="active" />
              {currentNode && (
                <div className="current-step">
                  <Text type="secondary">
                    当前步骤：{currentNode}
                  </Text>
                </div>
              )}
            </div>
          )}

          {problemAnalysis && (
            <div className="analysis-wrapper" ref={analysisRef}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>解题思路：</Text>
              <div className="markdown-content">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {problemAnalysis}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {messageText && !problemAnalysis && videoUrl && (
            <div className={`message ${videoUrl ? 'success' : ''}`}>
              {messageText}
            </div>
          )}
        </div>

        {videoUrl && !videoModalOpen && (
          <div className="video-section">
            <video
              width="100%"
              src={videoUrl}
              controls
              className="video-player"
            />
            <Button
              type="primary"
              onClick={downloadVideo}
              className="download-btn"
            >
              下载视频
            </Button>
          </div>
        )}

        {/* 视频预览弹框 */}
        <Modal
          open={videoModalOpen}
          onCancel={() => setVideoModalOpen(false)}
          footer={[
            <Button key="download" type="primary" onClick={downloadVideo}>
              下载视频
            </Button>,
            <Button key="close" onClick={() => setVideoModalOpen(false)}>
              关闭
            </Button>,
          ]}
          className="video-modal"
          width={960}
          centered
          destroyOnHidden
        >
          <video
            width="100%"
            src={videoUrl}
            controls
            autoPlay
            style={{ marginTop: 16 }}
          />
        </Modal>
      </main>
    </div>
  );
}

export default App;
