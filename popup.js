document.getElementById('export').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN", // ВАЖНО: Позволяет читать window.AppConfig со страницы Яндекса
    function: exportFormLogic
  });
});

document.getElementById('import').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      
      // Базовая валидация, чтобы убедиться, что это нужный файл
      if (!Array.isArray(data)) {
        throw new Error("Файл должен содержать массив вопросов.");
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [data],
        world: "MAIN", // ВАЖНО: для доступа к window.AppConfig
        function: importFormLogic
      });
    } catch (err) {
      alert("Ошибка чтения файла: " + err.message);
    }
  };
  reader.readAsText(file);
  
  // Очищаем input, чтобы можно было загрузить тот же файл еще раз, если нужно
  event.target.value = ''; 
});

async function exportFormLogic() {
  const match = window.location.pathname.match(/[a-f0-9]{24}/);
  if (!match) {
    alert("Не удалось найти ID формы. Убедитесь, что вы находитесь в редакторе формы Яндекса.");
    return;
  }
  const surveyId = match[0];
  
  const isCloud = window.location.pathname.includes('/cloud/');
  const baseUrl = isCloud ? "/cloud/admin/gateway/root/form/" : "/admin/gateway/root/form/";
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

  const headers = { 
    "Content-Type": "application/json", 
    "x-csrf-token": csrfToken 
  };

  const orgId = window.AppConfig?.orgId || ""; 
  if (isCloud && orgId) headers["x-collab-org-id"] = orgId;

  try {
    const response = await fetch(`${baseUrl}surveyQuestionsLA`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ surveyId })
    });
    
    if (!response.ok) throw new Error(`Ошибка сервера: ${response.status}`);
    
    const data = await response.json();

    const orderedIds = data.nodes[0].items.map(item => `q_${item.id}`);
    const sortedQuestions = orderedIds.map(key => data.questionsMap[key]).filter(Boolean);

    const blob = new Blob([JSON.stringify(sortedQuestions, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `form_${surveyId}_export.json`;
    a.click();
    URL.revokeObjectURL(url); // Очищаем память
  } catch (err) {
    alert("Ошибка экспорта: " + err.message);
  }
}

async function importFormLogic(questionsArray) {
  const match = window.location.pathname.match(/[a-f0-9]{24}/);
  if (!match) {
    alert("Не удалось найти ID формы. Убедитесь, что вы находитесь в редакторе формы Яндекса.");
    return;
  }
  const surveyId = match[0];

  const isCloud = window.location.pathname.includes('/cloud/');
  const baseUrl = isCloud ? "/cloud/admin/gateway/root/form/" : "/admin/gateway/root/form/";
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
  
  const orgId = window.AppConfig?.orgId || ""; 

  const commonHeaders = {
    "Content-Type": "application/json",
    "x-csrf-token": csrfToken
  };
  if (isCloud && orgId) commonHeaders["x-collab-org-id"] = orgId;

  // Вспомогательная функция для паузы (Rate limit защита)
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    const initialResponse = await fetch(`${baseUrl}surveyQuestionsLA`, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({ surveyId })
    });
    
    if (!initialResponse.ok) throw new Error("Не удалось получить данные целевой формы.");
    
    const initialData = await initialResponse.json();
    const targetPageId = initialData.nodes[0].id;

    for (let i = 0; i < questionsArray.length; i++) {
      const q = questionsArray[i];
      const payload = {
        surveyId: surveyId,
        page: targetPageId,
        position: i + 1,
        question: {
          type: q.type,
          view: q.view,
          title: q.title,
          required: q.required || false,
          options: q.options,
          quiz: q.quiz
        }
      };

      const res = await fetch(`${baseUrl}addSurveyQuestion`, {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        console.error(`Ошибка при импорте вопроса ${i + 1}`);
      } else {
        console.log(`Успешно: ${i + 1}/${questionsArray.length}`);
      }

      // Пауза 300мс между запросами, чтобы Яндекс не заблокировал за спам
      await sleep(300); 
    }
    alert(`Миграция завершена! Импортировано вопросов: ${questionsArray.length}. Обновите страницу.`);
  } catch (err) {
    alert("Ошибка импорта: " + err.message);
  }
}