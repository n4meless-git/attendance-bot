require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// 🕒 한국 시간(KST) 헬퍼 함수
function getKSTInfo() {
    const now = new Date();
    const todayStr = now.toLocaleDateString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).replace(/\. /g, '-').replace('.', '');

    const hourStr = now.toLocaleTimeString('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        hour12: false
    });
    const currentHour = parseInt(hourStr, 10);

    return { today: todayStr, currentHour, nativeDate: now };
}

function getRemindMessage(hour) {
    if (hour === 11) return "좋은 아침이에요! 오늘도 잊지 말고 출근 도장 꾹 눌러주세요? ✨";
    if (hour === 14) return "벌써 오후 2시에요! 설마 오늘 출근 까먹으신 건 아니죠...? 얼른 오세요! 🤨";
    if (hour === 17) return "이제 해가 지려고 해요... 오늘 출근 안 하시면 연속 기록이 깨질지도 몰라요. 제발 와주세요. 😭";
    if (hour === 18) return "저기요... 아직도 안 오신 건가요? 6시예요. 이제 슬슬 걱정되기 시작하네요. 😟";
    if (hour === 19) return "7시입니다. 당신의 연속 출근 기록이 공중분해 되기 직전이에요. 지금 당장 오세요! ⚡";
    if (hour === 20) return "8시... 이제 제 목소리가 들리지 않나요? 당신의 성실함이 시험받고 있어요. ✊";
    if (hour === 21) return "9시예요. 이대로 포기하실 건가요? 지금까지 쌓아온 노력이 아깝지 않으세요? 😠";
    if (hour === 22) return "10시입니다. 이제 시간이 얼마 없어요. 제발... 마지막 기회일지도 몰라요. 🙏";
    if (hour === 23) return "11시!!! 이제 한 시간 뒤면 모든 게 끝납니다. 죽기 살기로 출근하세요! 빨리!!! 🚨🚨";
    return null;
}

// 🛡️ 재원이 대리 출근 공통 핵심 로직
async function runJaewonAttendance() {
    const { today } = getKSTInfo();
    const JAEWON_ID = "1152202483666538516";
    const JAEWON_NAME = "smphur08";

    const { data: user, error: selectError } = await supabase
        .from('attendance')
        .select('*')
        .eq('user_id', JAEWON_ID)
        .maybeSingle();

    if (selectError) throw selectError;

    if (user && user.last_checkin === today) {
        return { success: false, status: "ALREADY", reason: "이미 오늘 출근 처리가 되어 있습니다.", streak: user.streak };
    }

    let currentTokens = user ? (user.tokens ?? 200) : 200;
    if (currentTokens < 10) {
        return { success: false, status: "NO_TOKEN", reason: "보유 토큰이 부족합니다. (대리 출근에는 10 토큰이 필요합니다.)", streak: user ? user.streak : 0 };
    }

    currentTokens -= 10;

    let newStreak = 1;
    if (user && user.last_checkin) {
        const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
        const parts = formatter.formatToParts(new Date());
        const y = parts.find(p => p.type === 'year').value;
        const m = parts.find(p => p.type === 'month').value;
        const d = parts.find(p => p.type === 'day').value;
        
        const yesterday = new Date(`${y}-${m}-${d}T12:00:00+09:00`);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (user.last_checkin === yesterdayStr) {
            newStreak = (user.streak || 0) + 1;
        }
    }

    const currentCards = user ? (user.protection_cards ?? 0) : 0;

    await supabase.from('attendance').upsert({
        user_id: JAEWON_ID,
        username: JAEWON_NAME,
        last_checkin: today,
        streak: newStreak,
        tokens: currentTokens,
        protection_cards: currentCards
    }, { onConflict: 'user_id' });

    return { success: true, streak: newStreak, remainingTokens: currentTokens };
}

// 😈 [수정] 분리된 판돈과 보상을 적용한 자산 정산 및 개인 격리 확률 관리 로직
async function applySlotWinnings(message, userId, user, slotPrice, prize, resultText, slotDisplay, curseType = null) {
    let currentP444 = user.p_444 ?? 4.0;
    let currentP666 = user.p_666 ?? 1.0;

    let newP444 = currentP444;
    let newP666 = currentP666;

    // 가변 확률 조정
    if (curseType === '444') {
        newP444 = 4.0;
    } else if (curseType === '666') {
        newP666 = 1.0;
    } 
    else if (prize > slotPrice) { // 판돈보다 높은 상금을 땄을 때 확률 누적
        newP444 = Math.min(currentP444 + 0.4, 99.0);
        newP666 = Math.min(currentP666 + 0.5, 99.0);
    }

    if (Math.floor(currentP444 / 10) < Math.floor(newP444 / 10)) {
        try {
            await message.author.send(`⚠️ **[개인 경고]** 슬롯머신 수익 누적으로 인해 **444 사(死)의 저주 확률**이 **${Math.floor(newP444)}%**를 돌파했습니다!`);
        } catch (e) {}
    }
    if (Math.floor(currentP666 / 10) < Math.floor(newP666 / 10)) {
        try {
            await message.author.send(`💀 **[개인 극비 경고]** 심연의 존재가 주시합니다. **666 지옥의 저주 확률**이 **${Math.floor(newP666)}%**를 돌파했습니다!`);
        } catch (e) {}
    }

    // 💰 [핵심 수정] 판돈 차감 후 당첨 보상 지급 프로세스 분리
    let startTokens = user.tokens ?? 200;
    let afterBetTokens = startTokens - slotPrice; // 1단계: 판돈 선차감
    let finalTokens = afterBetTokens + prize;      // 2단계: 당첨 보상 합산 (저주일 경우 마이너스 적용)

    if (finalTokens < 0) finalTokens = 0;
    finalTokens = Math.round(finalTokens * 100) / 100;

    await supabase.from('attendance').upsert({
        user_id: userId,
        username: message.author.username,
        tokens: finalTokens,
        protection_cards: user.protection_cards ?? 0,
        streak: user.streak ?? 0,
        last_checkin: user.last_checkin,
        p_444: newP444,
        p_666: newP666
    }, { onConflict: 'user_id' });

    // 정산 텍스트 포맷 분리 출력
    let displayPrize = prize >= 0 ? `+${prize} 토큰` : `${prize} 토큰`;

    return message.reply(
        `🎰 **SLOT MACHINE** 🎰\n` +
        `${slotDisplay}\n` +
        `-------------------------\n` +
        `${resultText}\n` +
        `💸 **판돈 차감:** [ -${slotPrice} 토큰 ]\n` +
        `🎁 **당첨 보상:** [ ${displayPrize} ]\n` +
        `💳 **현재 잔액:** ${finalTokens} 토큰 (나의 444: ${newP444.toFixed(1)}% | 나의 666: ${newP666.toFixed(1)}%)`
    );
}

client.once('ready', () => {
    console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);

    // ⏰ 재원이 자동 대리 출근 (23시)
    cron.schedule('0 23 * * *', async () => {
        try {
            const result = await runJaewonAttendance();
            if (result.success) {
                console.log(`✨ [자동완료] 23시 대리 출근 성공!`);
            }
        } catch (err) { console.error(err); }
    }, { timezone: "Asia/Seoul" });

    // 정각 알림 스케줄러
    cron.schedule('0 * * * *', async () => {
        const { today, currentHour } = getKSTInfo();
        const messageText = getRemindMessage(currentHour);
        if (messageText) {
            const { data: allUsers } = await supabase.from('attendance').select('*');
            if (allUsers) {
                for (const user of allUsers) {
                    if (user.last_checkin !== today) {
                        try {
                            const discordUser = await client.users.fetch(user.user_id);
                            await discordUser.send(`🔔 <@${user.user_id}>님! ${messageText}`);
                        } catch (err) {}
                    }
                }
            }
        }
    }, { timezone: "Asia/Seoul" });

    // 23시 59분 자동 방어권 소모 및 초기화
    cron.schedule('59 23 * * *', async () => {
        const { today } = getKSTInfo();
        const { data: allUsers } = await supabase.from('attendance').select('*');
        if (!allUsers) return;

        for (const user of allUsers) {
            if (user.last_checkin !== today && (user.streak || 0) > 0) {
                let cards = user.protection_cards || 0;
                if (cards > 0) {
                    cards -= 1;
                    await supabase.from('attendance').update({ protection_cards: cards }).eq('user_id', user.user_id);
                    try {
                        const discordUser = await client.users.fetch(user.user_id);
                        await discordUser.send(`🛡️ 보호권이 사용되어 기록이 유지되었습니다! (남은 보호권: ${cards}개)`);
                    } catch (e) {}
                } else {
                    await supabase.from('attendance').update({ streak: 0 }).eq('user_id', user.user_id);
                    try {
                        const discordUser = await client.users.fetch(user.user_id);
                        await discordUser.send(`💀 보호권이 없어 연속 출근 횟수가 초기화되었습니다.`);
                    } catch (e) {}
                }
            }
        }
    }, { timezone: "Asia/Seoul" });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    const { today, currentHour } = getKSTInfo();

    const commandBody = message.content.trim();
    const args = commandBody.split(' ');
    const command = args.shift();

    if (command === "!재원") {
        try {
            await message.channel.sendTyping();
            const result = await runJaewonAttendance();
            if (result.success) {
                return message.reply(`🎯 **[수동 완료]** 대리 출근 성공! (잔여: 💰 \`${result.remainingTokens} 토큰\` / 🔥 연속 ${result.streak}일)`);
            } else {
                return message.reply(`ℹ️ **[스킵]** ${result.reason}`);
            }
        } catch (err) { return message.reply("❌ DB 처리 중 에러 발생"); }
    }

    if (command === "듀오링고") {
        const testMsg = getRemindMessage(currentHour);
        const finalMsg = testMsg ? testMsg : `현재 한국 시간 ${currentHour}시입니다.`;
        try {
            await message.author.send(`🧪 **[테스트 알림]**\n🔔 <@${userId}>님! ${finalMsg}`);
            return message.reply("성공! 개인 DM 확인 고고. 📩");
        } catch (err) { return message.reply("DM 전송 실패!"); }
    }

    if (command === "!상점") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const myTokens = user ? (user.tokens ?? 200) : 200;
            const myCards = user ? (user.protection_cards ?? 0) : 0;
            return message.reply(`🛒 **토큰 상점**\n👤 보유 토큰: 💰 \`${myTokens}\` | 보유 보호권: 🛡️ \`${myCards}개\`\n📦 **🛡️ 출근 횟수 보호권** | 가격: \`100 토큰\`\n👉 구매: \`!구매\` | 환불: \`!환불\` (수수료 제외 80토큰 반환)`);
        } catch (err) { return message.reply("상점 로드 실패."); }
    }

    if (command === "!구매") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;

            if (currentTokens < 100) return message.reply(`❌ 토큰 부족! (보유: 💰 \`${currentTokens}\`)`);

            await supabase.from('attendance').upsert({
                user_id: userId, username: message.author.username,
                tokens: currentTokens - 100, protection_cards: currentCards + 1,
                streak: user ? user.streak : 0, last_checkin: user ? user.last_checkin : null
            }, { onConflict: 'user_id' });

            return message.reply(`🛒 구매 완료! (잔여: 💰 \`${currentTokens - 100}\` | 보호권: 🛡️ \`${currentCards + 1}개\`)`);
        } catch (err) { return message.reply("구매 오류."); }
    }

    if (command === "!환불") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;

            if (currentCards < 1) return message.reply(`❌ 환불할 보호권이 없습니다.`);

            await supabase.from('attendance').upsert({
                user_id: userId, username: message.author.username,
                tokens: currentTokens + 80, protection_cards: currentCards - 1,
                streak: user ? user.streak : 0, last_checkin: user ? user.last_checkin : null
            }, { onConflict: 'user_id' });

            return message.reply(`💸 환불 완료! 80 토큰 반환. (현재 보유: 💰 \`${currentTokens + 80}\` | 보유 보유권: 🛡️ \`${currentCards - 1}개\`)`);
        } catch (err) { return message.reply("환불 오류."); }
    }

    if (command === '!도박') {
        return message.reply(
            `🎲 **[도박 시스템 안내소]** 🎲\n` +
            `원하는 도박판의 명령어를 입력하세요. (기본 판돈: 슬롯 25토큰 / 로또 수동 50, 자동 55토큰)\n\n` +
            `🎰 **슬롯머신 계열**\n` +
            `• \`!슬롯3\` : 클래식 3x1 슬롯 (페어 50 / 잭팟 500 / 트레져헌터 300 / 더블윙 200 / 푸르티 150 / 넘버 65)\n` +
            `• \`!슬롯53\` : 5열 3행 완벽 격자 대형 도박판\n` +
            `• \`!슬롯25\` : 2열 5행 보드에서 고르는 10칸 뒤집기 스페셜 (입력: \`!1 5 8\`)\n` +
            `• \`!슬롯7\` : 7열 1행 초고속 한 줄 다이렉트 도박판\n\n` +
            `🎫 **로또 복권 계열**\n` +
            `• \`!로또자동\` : 마킹을 기계에 맡기는 자동 복권 구매\n` +
            `• \`!로또수동\` : 내 직감으로 번호 6개를 직접 입력 (\`!로또수동 번호1 번호2 ...\`)\n\n` +
            `🚪 **확률 제어 시스템**\n` +
            `• \`!종료\` : 본인에게 쌓인 444, 666 저주 누적 확률을 초기 기본값으로 리셋\n\n` +
            `👉 *원하는 명령어를 선택하여 입력해주세요!*`
        );
    }

    if (command === '!종료') {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            if (!user) return message.reply("ℹ️ 생성된 도박 정보가 등록되어 있지 않은 신규 사용자입니다.");

            await supabase.from('attendance').update({
                p_444: 4.0,
                p_666: 1.0
            }).eq('user_id', userId);

            return message.reply(`🚪 **[세션 종료]** <@${userId}>님의 슬롯 가변 저주 확률이 기본 수치로 안전하게 리셋되었습니다! (444: 4.0% | 666: 1.0%)`);
        } catch (e) { return message.reply("❌ 세션 초기화 에러 발생"); }
    }

    // =========================================================
    // 🎰 슬롯머신 도박 엔진 종합 관리
    // =========================================================
    if (['!슬롯3', '!슬롯53', '!슬롯7'].includes(command)) {
        try {
            const slotPrice = 25;
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const u = user || { tokens: 200, p_444: 4.0, p_666: 1.0 };
            
            if ((u.tokens ?? 200) < slotPrice) {
                return message.reply(`❌ 토큰이 부족합니다! 판돈은 **${slotPrice} 토큰**입니다.`);
            }

            const baseEmojis = ['7️⃣', '💎', '🍀', '🍇', '🍊', '🍒', '🔔'];
            const chance666 = (u.p_666 ?? 1.0) / 100;
            const chance444 = (u.p_444 ?? 4.0) / 100;

            const generateSymbol = () => {
                const rand = Math.random();
                if (rand < chance666) return '6️⃣';
                if (rand < chance666 + chance444) return '4️⃣';
                return baseEmojis[Math.floor(Math.random() * baseEmojis.length)];
            };

            // Mode 1: [!슬롯3] - 판돈과 보상 완전히 분리된 정산 메커니즘
            if (command === '!슬롯3') {
                let row = Array.from({ length: 3 }, generateSymbol);
                let slotDisplay = `[ ${row.join(' | ')} ]`;

                let prize = 0;
                let curseType = null;
                let resultText = '';

                const fruitsAndBell = ['🍇', '🍊', '🍒', '🔔'];
                const numbers = ['7️⃣', '4️⃣', '6️⃣'];

                const count6 = row.filter(s => s === '6️⃣').length;
                const count4 = row.filter(s => s === '4️⃣').length;
                const uniqueSymbols = new Set(row);

                // 1. 최상위 저주 및 3개 일치(트리플) 라인 검증
                if (count6 === 3) { 
                    curseType = '666'; 
                    prize = -1500; // 보상값 자체를 패널티로 부여
                    resultText = '💀 **[3x1 루시퍼] 심연의 군주가 깨어났습니다! (1500토큰 강제 소멸)** 💀'; 
                } 
                else if (count4 === 3) { 
                    curseType = '444'; 
                    prize = -444.4;
                    resultText = '👁️ **[3x1 사신 도래] 거둘 영혼이 정해졌습니다. (444.4토큰 소멸)** 👁️'; 
                } 
                else if (uniqueSymbols.size === 1 && row[0] === '7️⃣') { 
                    prize = 500; 
                    resultText = '👑 **[3x1 잭팟] 축하합니다! 신화의 벽을 뚫었습니다! (500토큰 획득)** 👑'; 
                }
                else if (uniqueSymbols.size === 1 && row[0] === '💎') { 
                    prize = 300; 
                    resultText = '💎 **[3x1 트레져헌터] 전설 속 고대 보물상자를 개봉했습니다! (300토큰 획득)** 💎'; 
                }
                // 2. 더블윙 검증 (가운데 상관없이 양 끝 날개가 네잎클로버 🍀)
                else if (row[0] === '🍀' && row[2] === '🍀') {
                    prize = 200;
                    resultText = '🍀 **[3x1 더블윙] 양날개에 깃든 행운! 가운데를 감싸 안는 완벽한 대칭! (200토큰 획득)** 🍀';
                }
                // 3. 일반 트리플 검증 (나머지 일반 과일/종 심볼들의 3개 완벽 일치)
                else if (uniqueSymbols.size === 1) {
                    const sym = row[0];
                    prize = 100; 
                    resultText = `🎉 **[3x1 트리플] 문양 3개가 완벽하게 정렬되었습니다! [ ${sym} ] (100토큰 획득)** 🎉`;
                } 
                // 4. 푸르티 잭팟 검증 (서로 다른 과일/종 3개)
                else if (uniqueSymbols.size === 3 && row.every(s => fruitsAndBell.includes(s))) {
                    prize = 150;
                    resultText = '🍇🍊🍒 **[3x1 푸르티 잭팟] 상큼하게 믹스된 과일 정원! (150토큰 획득)**';
                }
                // 5. 넘버 잭팟 검증 (서로 다른 숫자 3개 조합: 7, 4, 6)
                else if (uniqueSymbols.size === 3 && row.every(s => numbers.includes(s))) {
                    prize = 65;
                    resultText = '🔢 **[3x1 넘버 잭팟] 묘하게 얽힌 세 가지 숫자의 운명! (65토큰 획득)**';
                }
                // 6. 페어 검증 (종류 관계없이 2개 문양 일치)
                else if (uniqueSymbols.size === 2) {
                    prize = 50;
                    resultText = '🍀 **[3x1 페어] 2개의 심볼이 짝을 지어 방어 성공! (50토큰 획득)**';
                } 
                // 7. 낙첨 (보상 5토큰 방어 지급)
                else {
                    prize = 5;
                    resultText = '◽ **[3x1 낙첨] 아쉽게 비껴갔지만 소소한 위로금이 지급됩니다. (5토큰 획득)** ◽';
                }

                // [수정] applySlotWinnings에 판돈(slotPrice)과 당첨금(prize)을 따로 떼서 보냄
                return applySlotWinnings(message, userId, u, slotPrice, prize, resultText, slotDisplay, curseType);
            }

            // Mode 2: [!슬롯7] - 규격 통합 처리
            if (command === '!슬롯7') {
                let row = Array.from({ length: 7 }, generateSymbol);
                let slotDisplay = `[ ${row.join(' | ')} ]`;
                
                const center = row[3];
                const count7 = row.filter(s => s === '7️⃣').length;
                const count6 = row.filter(s => s === '6️⃣').length;
                const count4 = row.filter(s => s === '4️⃣').length;

                let prize = 0;
                let curseType = null;
                let resultText = '';

                if (center === '7️⃣' && count7 >= 3) { prize = 400; resultText = '🔥 **[슬롯7 럭키마스터] 정중앙 7 안착 및 3성 정렬! (400토큰 획득)** 🔥'; }
                else if (count6 >= 3) { curseType = '666'; prize = -1500; resultText = '💀 **[슬롯7 심연의 지배] 판 내에 6이 3개 이상 증식했습니다! (1500토큰 소멸)** 💀'; }
                else if (count4 >= 4) { curseType = '444'; prize = -444.4; resultText = '👁️ **[슬롯7 사계의 저주] 판 내에 4가 4개 이상 깔렸습니다! (444.4토큰 소멸)** 👁️'; }
                else if (center === '💎' || center === '7️⃣') { prize = 50; resultText = '✨ **[슬롯7 센터 조준] 핵심 코어에 고가치 심볼이 박혔습니다! (50토큰 획득)**'; }
                else if (new Set(row).size <= 3) { prize = 120; resultText = '🎉 **[슬롯7 고밀도 조합] 문양들이 모여서 압축 당첨! (120토큰 획득)** 🎉'; }
                else { prize = 5; resultText = '◽ **[슬롯7 소소] 소소한 과일 찌꺼기 보상입니다. (5토큰 획득)**'; }

                return applySlotWinnings(message, userId, u, slotPrice, prize, resultText, slotDisplay, curseType);
            }

            // Mode 3: [!슬롯53] - 규격 통합 처리
            if (command === '!슬롯53') {
                let matrix = [];
                let slotDisplay = '';
                for (let i = 0; i < 3; i++) {
                    let row = Array.from({ length: 5 }, generateSymbol);
                    matrix.push(row);
                    slotDisplay += `[ ${row.join(' | ')} ]\n`;
                }

                let prize = 0;
                let curseType = null;
                let resultText = '';
                
                let allSymbols = matrix.flat();
                const total6 = allSymbols.filter(s => s === '6️⃣').length;
                const total4 = allSymbols.filter(s => s === '4️⃣').length;

                const row1Set = new Set(matrix[0]);
                const row2Set = new Set(matrix[1]);
                const row3Set = new Set(matrix[2]);

                if (total6 >= 5) {
                    curseType = '666'; prize = -1500;
                    resultText = '💀☠️ **[5x3 대재앙] 보드 전체가 지옥의 숫자로 오염되었습니다!!! 1500토큰이 강제 소멸합니다!** ☠️💀';
                } else if (total4 >= 6) {
                    curseType = '444'; prize = -444.4;
                    resultText = '👁️🚨 **[5x3 죽음의 낙인] 사(死)의 에너지가 폭발합니다! 444.4토큰이 영구 차감됩니다!** 🚨👁️';
                } else if (row2Set.size === 1) { 
                    const sym = matrix[1][0];
                    if (sym === '7️⃣') { prize = 1200; resultText = '🔥👑 **[5x3 신화 잭팟] 중앙 77777 일렬 종대 달성!!! 전설의 귀환! (1200토큰 획득)** 👑🔥'; }
                    else if (sym === '💎') { prize = 800; resultText = '💎✨ **[5x3 전설 잭팟] 중앙 다이아몬드 풀 크리스탈 라인업! (800토큰 획득)** ✨💎'; }
                    else { prize = 400; resultText = `🎰 **[5x3 미들 잭팟] 중앙 가로라인 일치! [ ${sym} ] (400토큰 획득)** 🎰`; }
                } else if (row1Set.size === 1 || row3Set.size === 1) { 
                    prize = 250;
                    resultText = '🎉 **[5x3 사이드 라인] 상단 혹은 하단 가로 한 줄이 완벽히 통일되었습니다! (250토큰 획득)** 🎉';
                } else {
                    const corners = [matrix[0][0], matrix[0][4], matrix[2][0], matrix[2][4]];
                    const cornerSet = new Set(corners);
                    if (cornerSet.size === 1 && !corners.includes('4️⃣') && !corners.includes('6️⃣')) {
                        prize = 150;
                        resultText = '🍀✨ **[5x3 모서리 크로스] 네 꼭짓점의 문양이 소름 돋게 일치합니다! (150토큰 획득)** ✨🍀';
                    } else {
                        const maxMatches = Math.max(...baseEmojis.map(e => allSymbols.filter(s => s === e).length));
                        if (maxMatches >= 6) { prize = 60; resultText = `📈 **[5x3 밀집 당첨] 한 종류의 문양이 6개 이상 모였습니다! (60토큰 획득)**`; }
                        else if (maxMatches >= 4) { prize = 20; resultText = `🎉 **[5x3 일반 당첨] 나란히 모인 문양들이 보상을 줍니다. (20토큰 획득)**`; }
                        else { prize = 0; resultText = '😭 **[5x3 낙첨] 격자를 맞추지 못했습니다. 다음 기회에 도전하세요!** 😭'; }
                    }
                }

                return applySlotWinnings(message, userId, u, slotPrice, prize, resultText, slotDisplay, curseType);
            }
        } catch (err) {
            console.error(err);
            return message.reply("슬롯머신 구동 실패.");
        }
    }

    // =========================================================
    // 🎰 Mode 4: [!슬롯25] - 2열 5행(10칸) 뒤집기 스페셜
    // =========================================================
    if (command === '!슬롯25') {
        try {
            const slotPrice = 25;
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const u = user || { tokens: 200 };

            if ((u.tokens ?? 200) < slotPrice) return message.reply(`❌ 토큰이 부족합니다!`);

            const baseEmojis = ['7️⃣', '💎', '🍀', '🍇', '🍊', '🍒', '🔔'];
            const chance666 = (u.p_666 ?? 1.0) / 100;
            const chance444 = (u.p_444 ?? 4.0) / 100;

            const hiddenBoard = Array.from({ length: 10 }, () => {
                const rand = Math.random();
                if (rand < chance666) return '6️⃣';
                if (rand < chance666 + chance444) return '4️⃣';
                return baseEmojis[Math.floor(Math.random() * baseEmojis.length)];
            });

            if (!client.slot25Data) client.slot25Data = new Map();
            client.slot25Data.set(userId, { hiddenBoard, timestamp: Date.now() });

            return message.reply(
                `🎲 **[슬롯25: 2x5 뒤집기 스페셜 도박판]** 판돈 **25 토큰** 대기 완료.\n` +
                `아래 10개의 뒷면 카드 중 대박 상금이 숨겨진 **3개의 번호**를 찍으세요!\n\n` +
                `1️⃣  2️⃣\n` +
                `3️⃣  4️⃣\n` +
                `5️⃣  6️⃣\n` +
                `7️⃣  8️⃣\n` +
                `9️⃣  🔟\n\n` +
                `👉 **입력 예시:** \`!1 5 8\` (공백으로 구분된 1~10 사이 숫자 3개)`
            );
        } catch (e) { return message.reply("슬롯25 생성 실패."); }
    }

    // 🎰 [!슬롯25용 인터셉터] !숫자로 시작하는 패턴 감지 (!1 5 8 형태 처리)
    if (command && command.startsWith('!') && !isNaN(command.slice(1))) {
        try {
            if (!client.slot25Data || !client.slot25Data.has(userId)) {
                return message.reply("❌ 먼저 \`!슬롯25\`로 도박판 판때기를 생성해야 합니다!");
            }

            const firstNum = command.slice(1);
            const allNumbers = [firstNum, ...args];

            if (allNumbers.length !== 3) {
                return message.reply("❌ 정확히 3개의 카드 번호를 입력하세요! 예: \`!1 4 10\`");
            }

            const chosenIndices = allNumbers.map(num => parseInt(num, 10) - 1);
            
            const isValid = chosenIndices.every(idx => idx >= 0 && idx < 10 && !isNaN(idx));
            const isUnique = new Set(chosenIndices).size === 3;

            if (!isValid || !isUnique) return message.reply("❌ 1부터 10 사이의 중복 없는 올바른 보드 인덱스를 고르셔야 합니다.");

            const session = client.slot25Data.get(userId);
            client.slot25Data.delete(userId); 

            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const u = user || { tokens: 200, p_444: 4.0, p_666: 1.0 };

            const s1 = session.hiddenBoard[chosenIndices[0]];
            const s2 = session.hiddenBoard[chosenIndices[1]];
            const s3 = session.hiddenBoard[chosenIndices[2]];

            let prize = 0;
            let curseType = null;
            let resultText = '';
            const slotDisplay = `🎰 **선택 카드 뒤집기 결과:** [ ${s1} | ${s2} | ${s3} ]`;

            if (s1 === '6️⃣' && s2 === '6️⃣' && s3 === '6️⃣') {
                curseType = '666'; prize = -1500; resultText = '💀 **[슬롯25 대재앙] 6 6 6 무덤 리빌! 1500토큰이 증발합니다!** 💀';
            } else if (s1 === '4️⃣' && s2 === '4️⃣' && s3 === '4️⃣') {
                curseType = '444'; prize = -444.4; resultText = '👁️ **[슬롯25 사선 오픈] 4 4 4 금기 봉인 해제! 444.4토큰 소멸!** 👁️';
            } else if (s1 === s2 && s2 === s3) {
                if (s1 === '7️⃣') { prize = 1500; resultText = '🔥 **[슬롯25 신화 트리플] 황금의 손가락! 777 저격 완료! (1500토큰 획득)** 🔥'; }
                else if (s1 === '💎') { prize = 900; resultText = '💎 **[슬롯25 쥬얼 트리플] 다이아몬드 광맥 채굴 성공! (900토큰 획득)** 💎'; }
                else { prize = 150; resultText = `🎰 **[슬롯25 일반 트리플] 골라잡은 트리플 라인! (150토큰 획득)** 🎰`; }
            } else if ((s1 === s2 || s2 === s3 || s1 === s3) && s1 !== '6️⃣' && s2 !== '6️⃣' && s3 !== '6️⃣' && s1 !== '4️⃣' && s2 !== '4️⃣' && s3 !== '4️⃣') {
                prize = 30; resultText = '🎉 **[슬롯25 페어 매치] 2개의 카드가 일치하여 소소하게 방어 성공! (30토큰 획득)** 🎉';
            } else {
                prize = 0; resultText = '😭 **[슬롯25 낙첨] 카드들이 서로 엇갈렸습니다. 감이 부족했네요!** 😭';
            }

            const slotPrice = 25;
            return applySlotWinnings(message, userId, u, slotPrice, prize, resultText, slotDisplay, curseType);

        } catch (err) { console.error(err); return message.reply("슬롯25 선택 처리기 가동 실패."); }
    }

    // =========================================================
    // 🎫 복권 시스템: !로또자동 / !로또수동
    // =========================================================
    if (command === '!로또자동' || command === '!로또수동') {
        try {
            const isAuto = (command === '!로또자동');
            const lottoPrice = isAuto ? 55 : 50; 

            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            let currentTokens = user ? (user.tokens ?? 200) : 200;

            if (currentTokens < lottoPrice) return message.reply(`❌ 토큰 부족! 잔액: ${currentTokens} 토큰`);

            let userNumbers = [];
            if (isAuto) {
                while (userNumbers.length < 6) {
                    let num = Math.floor(Math.random() * 45) + 1;
                    if (!userNumbers.includes(num)) userNumbers.push(num);
                }
            } else {
                if (args.length !== 6) return message.reply(`❌ 번호 마킹 누락! \`!로또수동 3 12 24 33 39 45\` 형태로 공백을 주어 6개를 적으세요!`);
                userNumbers = args.map(Number);
                if (userNumbers.some(num => num < 1 || num > 45 || isNaN(num)) || new Set(userNumbers).size !== 6) {
                    return message.reply('❌ 올바르지 않은 마킹 번호 리스트입니다. (1~45 사이 중복 없는 숫자 6개)');
                }
            }
            userNumbers.sort((a, b) => a - b);

            let winningNumbers = [];
            while (winningNumbers.length < 6) {
                let num = Math.floor(Math.random() * 45) + 1;
                if (!winningNumbers.includes(num)) winningNumbers.push(num);
            }
            winningNumbers.sort((a, b) => a - b);

            let bonusNumber;
            while (true) {
                let num = Math.floor(Math.random() * 45) + 1;
                if (!winningNumbers.includes(num)) { bonusNumber = num; break; }
            }

            const matchedCount = userNumbers.filter(num => winningNumbers.includes(num)).length;
            const isBonusMatched = userNumbers.includes(bonusNumber);

            let resultMessage = '😭 낙첨... 다음 회차에!';
            let prize = 0;

            if (matchedCount === 6) { resultMessage = '🎉 1등 대박 잭팟!!! 🎉'; prize = 5000; }
            else if (matchedCount === 5 && isBonusMatched) { resultMessage = '🥈 2등 보너스 적중!! 🥈'; prize = 1000; }
            else if (matchedCount === 5) { resultMessage = '🥉 3등 당첨! 고액 보상! 🥉'; prize = 500; }
            else if (matchedCount === 4) { resultMessage = '🏅 4등 당첨! 피자 값 확보! 🏅'; prize = 100; }
            else if (matchedCount === 3) { resultMessage = '◽ 5등 당첨! 본전 수거! ◽'; prize = 25; }

            const finalTokens = currentTokens - lottoPrice + prize;
            await supabase.from('attendance').update({ tokens: finalTokens }).eq('user_id', userId);

            return message.reply(
                `🎫 **인생역전 로또 영수증** 🎫\n` +
                `• 선택 방식: [ ${isAuto ? '자동 발급' : '수동 마킹'} ]\n` +
                `• 선택 번호: [ ${userNumbers.join(', ')} ]\n` +
                `• 당첨 번호: [ ${winningNumbers.join(', ')} ] + 보너스 [ ${bonusNumber} ]\n` +
                `-----------------------------------------\n` +
                `🎯 결과: ${resultMessage} (맞춘 개수: ${matchedCount}개)\n` +
                `💸 판돈 차감: [ -${lottoPrice} 토큰 ]\n` +
                `🎁 당첨 보상: [ +${prize} 토큰 ]\n` +
                `💳 현재 잔액: ${finalTokens} 토큰`
            );
        } catch (err) { return message.reply("로또 구동 실패."); }
    }

    // =========================================================
    // 🏃 기본 출근 시스템 컨텍스트 블록
    // =========================================================
    if (commandBody !== "출근" && commandBody !== "근출" && commandBody !== "출" && commandBody !== "근" && commandBody !== "出勤" && commandBody !== "ㅊㄱ" && commandBody !== "출첵" && commandBody !== "출석" && commandBody !== "attend" && commandBody !== "근." && commandBody !== "출." && commandBody !== "출 " && commandBody !== "근 " && commandBody !== "출군" && commandBody !== "앙" && commandBody !== "아잉" && commandBody !== "웅" && commandBody !== "출근해떠염" && commandBody !== "여자" && commandBody !== "ㅊㅊ" && commandBody !== "시기다른래퍼들의반대편을바라보던래퍼들의배포") return;

    if (currentHour >= 0 && currentHour < 4) {
        return message.reply("🚫 지금은 출근 자금 세탁 금지 시간입니다! 아침 일찍 오세요!");
    }

    try {
        const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
        if (user && user.last_checkin === today) return message.reply(`오늘 이미 도장을 찍었습니다! ✨`);

        let earnedTokens = 10;
        if (currentHour < 14) earnedTokens = 20;
        else if (currentHour < 18) earnedTokens = 15;

        let newStreak = 1;
        if (user && user.last_checkin) {
            const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
            const parts = formatter.formatToParts(new Date());
            const yesterday = new Date(`${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}T12:00:00+09:00`);
            yesterday.setDate(yesterday.getDate() - 1);
            if (user.last_checkin === yesterday.toISOString().split('T')[0]) newStreak = (user.streak || 0) + 1;
        }

        const totalTokens = (user ? (user.tokens ?? 200) : 200) + earnedTokens;
        await supabase.from('attendance').upsert({
            user_id: userId, username: message.author.username,
            last_checkin: today, streak: newStreak, tokens: totalTokens,
            protection_cards: user ? (user.protection_cards ?? 0) : 0
        }, { onConflict: 'user_id' });

        return message.reply(`✅ **출근 체크 성공!** 현재 **${newStreak}일** 연속 달리는 중! 🔥\n💰 \`${earnedTokens} 토큰\` 지급 (총액: \`${totalTokens} 토큰\`)`);
    } catch (err) { return message.reply("⚠️ 출근 DB 처리 에러 발생!"); }
});

client.login(process.env.DISCORD_TOKEN);
